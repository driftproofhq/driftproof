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
// gate under the lock the config names and re-run once on a red; then `staging` is pushed with a lease read just before. `nightly` reads a sweep's record and
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
//   node scripts/integrate.mjs digest <config.json> [--release] [--now <iso>]
//   node scripts/integrate.mjs pin-policy <config.json>
//   node scripts/integrate.mjs status <config.json>
//
// Intake, the digest and the budget guard (spec 068): `tick` reads each request on inbox
// (features/queue/<n>.md), has a brief session write its brief, commits the brief to inbox, and
// queues it for a builder at once for T3, or once the operator's approval file follows it for T1 and
// T2; a builder's diff that touches the T1 table or leaves T3's paths raises its tier. Every
// session's cost goes to a ledger; at the daily cap or on a usage-limit hit no session starts, and
// under the box-health thresholds no builder starts. `digest` commits the daily or the release
// digest to status/digest and runs retention over the manifest of what the integrator made. Every
// number lives in the settings file (specs/000-governance/integrator-settings.json), and the
// integrator refuses to start while its daily cap is empty.
//
// BUILT, NOT SWITCHED ON. Nothing here runs on a timer until the operator installs the units in
// deploy/ (spec 067). State is files under the config's state_dir (~/.driftproof-integrator by
// default): items/, merges/, ticks/, nightly/, agreements/, train/, serve/, flakes.jsonl and
// report.jsonl, which the digest reads; intake/, briefs/, budget/, health/, digest/, retention/ and
// manifest.jsonl (spec 068).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readPolicy, repoGateFigure, REPO_GATE_DEFAULT, STAGE_DEFAULTS, copyPaths, t3PathGuard, outsideT3, gateFigureAt, approvalFigure, receiptNamed } from './drive.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DRIVE = path.join(HERE, 'drive.mjs');
const POLICY_REL = 'specs/000-governance/integrator-policy.md';
const SETTINGS_REL = 'specs/000-governance/integrator-settings.json';
// the release bump's fixed brief (spec 067 R-2); intake writes the briefs of requests (spec 068)
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
// the three paths on inbox that intake reads and writes (spec 068 R-1)
const INTAKE = { queue: 'features/queue/', briefs: 'features/briefs/', approved: 'features/approved/' };
// R-7: Opus for briefs, fix loops and approvals, and the build; Sonnet for the mechanical triage
const STAGE_MODELS = { build: 'opus', approve: 'opus', triage: 'sonnet', fix: 'opus' };
const BRIEF_MODEL = 'opus';
const GB = 1024 ** 3;
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
  // spec 068 R-5: the numbers are the settings file's; a config names another only for a scratch world
  const settingsFile = c.settings ? abs(c.settings) : path.join(ROOT, SETTINGS_REL);
  const settings = readJson(settingsFile, null);
  const s = settings || {};
  return {
    file: path.resolve(file), remote_url: c.remote_url, remote: c.remote || 'private', source: c.source ? abs(c.source) : null,
    state, base_ref: c.base_ref || 'dev', staging: c.staging || 'staging',
    stop_file: abs(c.stop_file || path.join(state, 'STOP')), pause_file: abs(c.pause_file || path.join(state, 'PAUSE')),
    marker_dir: abs(c.marker_dir || '/var/tmp'), lock: c.lock ? abs(c.lock) : null, builders: c.builders,
    approve_cwd: abs(c.approve_cwd || '~/.driftproof-approve'), agree_cwd: abs(c.agree_cwd || '~/.driftproof-agree'),
    policy: c.policy ? abs(c.policy) : path.join(ROOT, POLICY_REL),
    limits: { ...(s.limits || {}), ...(c.limits || {}) },
    settings: { file: settingsFile, data: settings },
    health_readings: c.health_readings ? abs(c.health_readings) : null,
    builder_stages: c.builder_stages || {},
    train: {
      stage_root: abs((c.train || {}).stage_root || '/var/tmp'),
      nightly_state: abs((c.train || {}).nightly_state || '~/.driftproof-nightly'),
      checkout: abs((c.train || {}).checkout || '~/driftproof'),
      interval_seconds: Number((c.train || {}).interval_seconds || (Number(s.poll_minutes) * 60)),
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
  if (!fs.existsSync(log)) created(ctx, log, 'log');
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
    try { const j = JSON.parse(line); if (j.type === 'system' && j.subtype === 'init') Object.assign(seen, { model: j.model || null, session_id: j.session_id || null, cwd: j.cwd || null }); if (j.type === 'result') seen.cost = j.total_cost_usd; } catch {}
  }
  // spec 068 R-4: the agreement's cost, or its cap when the stream names none, and any usage-limit hit
  const hit = usageLimitIn(r.stdout);
  book(ctx, { key: `agreement:${it.id}:${tip}:${path.basename(scratch)}`, kind: 'agreement', item: it.id, cost_usd: typeof seen.cost === 'number' ? seen.cost : 1, usage_limit: !!hit });
  if (hit) usageLimitHit(ctx, hit, `agreement:${it.id}:${tip}:${path.basename(scratch)}`, it.id);
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
          // spec 068: the agreement is a session, and the budget guard holds every session
          const bs = budgetState(ctx).stop;
          if (bs) throw new Halt(`the budget guard holds sessions (${bs.kind}) before the separate agreement session could start`);
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
  // an item raised to a higher tier builds again in a clone of its own (spec 068 R-3)
  const dir = path.join(cfg.state, 'clones', it.rebuild ? `${it.id}-${it.rebuild}` : it.id);
  const repo = path.join(dir, 'repo');
  if (!fs.existsSync(path.join(repo, '.git'))) {
    fs.mkdirSync(dir, { recursive: true });
    created(ctx, dir, 'clone');
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
      // spec 068 R-3: the builder's diff may raise the tier, and a raised item waits for the operator
      const raise = tierRaise(ctx, it);
      if (raise) {
        // a raise whose brief cannot be committed leaves the item as it was on disk, building and
        // ended, so the next pass reads the raise again; it is never merged un-raised
        try { applyRaise(ctx, it, raise); } catch (e) {
          ctx.report('intake-error', it, { error: `the raise to ${raise.to} could not be committed to inbox: ${String(e.message).slice(0, 250)}` });
          continue;
        }
      } else {
        ctx.save(it);
        ctx.report('approved', it, {});
      }
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

// ── the settings file (spec 068 R-5) ────────────────────────────────────────────────────────────
// Every value the integrator reads from it, each named when it is missing or not what it must be.
// The cap first: it is the one the operator fills in at switch-on.
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const pos = (x) => typeof x === 'number' && Number.isFinite(x) && x > 0;
function settingsProblems(cfg) {
  const s = cfg.settings.data;
  const f = cfg.settings.file;
  if (!s) return [`the settings file ${f} is not readable JSON`];
  const out = [];
  const need = (ok, what) => { if (!ok) out.push(what); };
  const b = s.budget || {};
  need(pos(b.daily_usd), `budget.daily_usd is ${JSON.stringify(b.daily_usd ?? null)} in ${f}: the daily cap is required and has no default; the operator fills it in at switch-on, and the integrator refuses to start until then`);
  need(HHMM.test(String(b.day_starts)), 'budget.day_starts is not a time HH:MM');
  need(/^[+-]\d{2}:\d{2}$/.test(String(b.zone)), 'budget.zone is not an offset such as +08:00');
  const h = s.health || {};
  need(pos(h.disk_free_gb) && pos(h.memory_available_gb), 'health.disk_free_gb and health.memory_available_gb are not both positive numbers');
  need(typeof h.disk_path === 'string' && h.disk_path !== '', 'health.disk_path is not a path: the disk read has no default');
  need(pos(s.retention_days), 'retention_days is not a positive number');
  need(pos(s.poll_minutes), 'poll_minutes is not a positive number');
  const d = s.digest || {};
  need(d.daily_at === null || HHMM.test(String(d.daily_at)), 'digest.daily_at is neither null nor a time HH:MM');
  need(typeof d.on_release === 'boolean', 'digest.on_release is not true or false');
  const l = s.limits || {};
  need(['fix_loops', 'reruns_per_gate', 'session_minutes', 'flake_days', 'flake_count'].every((k) => typeof l[k] === 'number' && l[k] >= 0), 'limits does not carry fix_loops, reruns_per_gate, session_minutes, flake_days and flake_count');
  const bs = s.brief_session || {};
  need(pos(bs.max_turns) && pos(bs.minutes) && pos(bs.usd), 'brief_session does not carry max_turns, minutes and usd');
  for (const k of ['t1_paths', 'public_text_paths']) {
    const ok = Array.isArray(s[k]) && s[k].length > 0 && s[k].every((e) => { try { return e && typeof e.re === 'string' && new RegExp(e.re) && !!e.source; } catch { return false; } });
    need(ok, `${k} is not a list of entries each with a pattern (re) and its source`);
  }
  return out;
}
function refusedBySettings(cfg, cmd) {
  const probs = settingsProblems(cfg);
  if (!probs.length) return null;
  process.stderr.write(`integrate: ${cmd} refused (settings): ${probs.join('; ')}\n`);
  return probs;
}
const tableOf = (ctx, k) => (ctx.cfg.settings.data[k] || []).map((e) => new RegExp(e.re));

// ── the manifest of what the integrator made (R-6) ─────────────────────────────────────────────
const manifestFile = (cfg) => path.join(cfg.state, 'manifest.jsonl');
function created(ctx, p, kind) {
  appendJsonl(manifestFile(ctx.cfg), { path: p, kind, created: ctx.clock().toISOString(), by: 'scripts/integrate.mjs' });
}

// ── the budget guard (R-4) ──────────────────────────────────────────────────────────────────────
const budgetDir = (cfg) => path.join(cfg.state, 'budget');
const ledgerFile = (cfg) => path.join(budgetDir(cfg), 'sessions.jsonl');
function zoneMinutes(z) {
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(String(z));
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : NaN;
}
// The budget day a time belongs to: the date of the latest day start at or before it, in the zone.
function dayOf(ctx, t) {
  const b = ctx.cfg.settings.data.budget;
  const offset = zoneMinutes(b.zone);
  const [h, m] = b.day_starts.split(':').map(Number);
  return new Date(Date.parse(t) + (offset - h * 60 - m) * 60000).toISOString().slice(0, 10);
}
// A date in the settings zone, for a digest's name.
const localDate = (ctx, t) => new Date(Date.parse(t) + zoneMinutes(ctx.cfg.settings.data.budget.zone) * 60000).toISOString().slice(0, 10);
const localTime = (ctx, t) => new Date(Date.parse(t) + zoneMinutes(ctx.cfg.settings.data.budget.zone) * 60000).toISOString().slice(11, 16);
// A time a builder's driver wrote on the wall clock, on this run's clock (the same, without --now).
const onClock = (ctx, t) => new Date(ctx.clock().getTime() - (Date.now() - Date.parse(t))).toISOString();

// The first usage-limit hit in a session's stream: a rate_limit_event whose status is rejected.
function usageLimitIn(text) {
  for (const l of String(text || '').split('\n')) {
    if (!l.includes('rate_limit_event')) continue;
    let j; try { j = JSON.parse(l); } catch { continue; }
    if (j.type === 'rate_limit_event' && j.rate_limit_info && j.rate_limit_info.status === 'rejected') {
      const i = j.rate_limit_info;
      return { resets_at: Number.isFinite(i.resetsAt) ? new Date(i.resetsAt * 1000).toISOString() : null, type: i.rateLimitType || null, overage: !!i.isUsingOverage };
    }
  }
  return null;
}
function book(ctx, entry) {
  const f = ledgerFile(ctx.cfg);
  ctx.ledgerKeys ||= new Set(jsonl(f).map((x) => x.key));
  if (ctx.ledgerKeys.has(entry.key)) return false;
  ctx.ledgerKeys.add(entry.key);
  const t = entry.t || ctx.clock().toISOString();
  appendJsonl(f, { ...entry, t, day: dayOf(ctx, t) });
  return true;
}
function usageLimitHit(ctx, hit, where, item) {
  const f = path.join(budgetDir(ctx.cfg), 'usage-limit.json');
  const seen = path.join(budgetDir(ctx.cfg), 'usage-limit-hits.jsonl');
  if (jsonl(seen).some((x) => x.where === where)) return;
  const at = ctx.clock().toISOString();
  appendJsonl(seen, { where, at, ...hit });
  writeJson(f, { at, where, item: item || null, resets_at: hit.resets_at, rate_limit_type: hit.type, overage_in_use: hit.overage });
  ctx.report('usage-limit', item ? { id: item } : null, { resets_at: hit.resets_at, rate_limit_type: hit.type, overage_in_use: hit.overage, where });
}
// Each builder's finished sessions into the ledger, on the day each ended; each stream read for a
// usage-limit hit, a running session's too.
function syncLedger(ctx) {
  for (const it of ctx.items().filter((i) => i.clone_dir && i.worktree)) {
    const p = progressOf(it);
    const recDir = path.join(it.worktree, 'specs', it.id, 'evidence', 'driver');
    for (const st of (p && p.stages) || []) {
      if (st.kind !== 'session' || st.cost_usd == null || !st.ended) continue;
      const rec = st.record ? readJson(path.join(recDir, st.record), null) : null;
      let hit = null;
      if (rec && rec.raw_stream && rec.raw_stream.path) { try { hit = usageLimitIn(fs.readFileSync(rec.raw_stream.path, 'utf8')); } catch {} }
      book(ctx, { key: `builder:${it.clone_dir}:${st.n}`, t: onClock(ctx, st.ended), kind: 'builder', item: it.id, stage: st.stage, cost_usd: st.cost_usd, usage_limit: !!hit });
      if (hit) usageLimitHit(ctx, hit, rec.raw_stream.path, it.id);
    }
    const raw = path.join(it.clone_dir, 'drive-state', 'raw', it.id);
    if (it.state === 'building' && fs.existsSync(raw)) {
      for (const n of fs.readdirSync(raw).filter((x) => x.endsWith('.jsonl'))) {
        let hit = null;
        try { hit = usageLimitIn(fs.readFileSync(path.join(raw, n), 'utf8')); } catch {}
        if (hit) usageLimitHit(ctx, hit, path.join(raw, n), it.id);
      }
    }
  }
}
// The day's spend against the cap, and whether a stop holds: a usage-limit hit until its reset, then
// the cap until the next day starts.
function budgetState(ctx) {
  const { cfg } = ctx;
  const now = ctx.clock().toISOString();
  const day = dayOf(ctx, now);
  const entries = jsonl(ledgerFile(cfg)).filter((x) => x.day === day);
  const spent = entries.reduce((t, x) => t + (Number(x.cost_usd) || 0), 0);
  const cap = cfg.settings.data.budget.daily_usd;
  const lim = readJson(path.join(budgetDir(cfg), 'usage-limit.json'), null);
  let stop = null;
  if (lim && (!lim.resets_at || Date.parse(lim.resets_at) > Date.parse(now))) stop = { kind: 'usage-limit', why: `a session met the usage limit at ${lim.at}; no session starts until ${lim.resets_at || 'the operator removes budget/usage-limit.json'}`, until: lim.resets_at || null };
  else if (pos(cap) && spent >= cap) stop = { kind: 'cap', why: `the spend of the budget day ${day} is ${spent.toFixed(2)} USD, at or over the daily cap of ${cap} USD`, until: null };
  if (stop) {
    const f = path.join(budgetDir(cfg), 'stops.jsonl');
    if (!jsonl(f).some((x) => x.day === day && x.kind === stop.kind)) { appendJsonl(f, { day, kind: stop.kind, at: now, why: stop.why }); ctx.report('budget-stop', null, { kind: stop.kind, day, why: stop.why }); }
  }
  return { day, spent: Number(spent.toFixed(6)), cap, sessions: entries.length, stop };
}

// ── box health (R-7) ────────────────────────────────────────────────────────────────────────────
function healthNow(ctx) {
  const { cfg } = ctx;
  const h = cfg.settings.data.health;
  let disk = null; let mem = null;
  if (cfg.health_readings) {
    const r = readJson(cfg.health_readings, {}) || {};
    disk = Number.isFinite(r.disk_free_bytes) ? r.disk_free_bytes : null;
    mem = Number.isFinite(r.mem_available_bytes) ? r.mem_available_bytes : null;
  } else {
    try { const st = fs.statfsSync(h.disk_path); disk = st.bavail * st.bsize; } catch {}
    try { mem = Number(/^MemAvailable:\s+(\d+) kB/m.exec(fs.readFileSync('/proc/meminfo', 'utf8'))[1]) * 1024; } catch {}
  }
  // a reading that cannot be taken counts as low: a check that did not run is never a pass
  const one = (bytes, gb) => ({ bytes, gb: bytes == null ? null : bytes / GB, threshold_gb: gb, low: bytes == null || bytes < gb * GB });
  const out = { disk: one(disk, h.disk_free_gb), memory: one(mem, h.memory_available_gb) };
  out.low = [
    ...(out.disk.low ? [out.disk.bytes == null ? 'disk not readable' : `disk ${out.disk.gb.toFixed(1)} GB free, under ${h.disk_free_gb} GB`] : []),
    ...(out.memory.low ? [out.memory.bytes == null ? 'memory not readable' : `memory ${out.memory.gb.toFixed(1)} GB available, under ${h.memory_available_gb} GB`] : []),
  ];
  return out;
}
// One CPU sample per service pass while the nightly's window is open: the share of time busy since
// the last sample.
function sampleCpu(ctx) {
  const w = readJson(path.join(ctx.cfg.state, 'window.json'), {}) || {};
  if (!w.open) return null;
  const now = os.cpus().reduce((t, c) => { for (const [k, v] of Object.entries(c.times)) t[k === 'idle' ? 'idle' : 'busy'] += v; return t; }, { idle: 0, busy: 0 });
  const f = path.join(ctx.cfg.state, 'health', 'cpu-last.json');
  const prev = readJson(f, null);
  writeJson(f, now);
  if (!prev) return null;
  const busy = now.busy - prev.busy; const idle = now.idle - prev.idle;
  if (busy + idle <= 0) return null;
  const s = { t: ctx.clock().toISOString(), night: w.opened_for || null, busy_pct: Math.round((100 * busy) / (busy + idle)) };
  appendJsonl(path.join(ctx.cfg.state, 'health', 'cpu.jsonl'), s);
  return s;
}

// ── committing to inbox and status/digest ───────────────────────────────────────────────────────
// One file written onto the remote's branch, on top of what it holds, by plumbing in the
// integrator's clone, and pushed as a fast-forward (spec 067's pushFastForward). Returns the commit.
function commitFile(ctx, ref, rel, text, message) {
  if (!ctx.repo) ensureClone(ctx);
  if (!INTEGRATOR_REFS.includes(ref) || ref === ctx.cfg.staging) throw new Error(`${ref} is not a branch the integrator writes files to`);
  // a push refused because the branch moved between the fetch and the push is fetched and tried once more
  try { return commitFileOnce(ctx, ref, rel, text, message); } catch { return commitFileOnce(ctx, ref, rel, text, message); }
}
function commitFileOnce(ctx, ref, rel, text, message) {
  const { cfg, repo } = ctx;
  git(repo, 'fetch', '-q', cfg.remote, `+refs/heads/${ref}:refs/remotes/${cfg.remote}/${ref}`);
  const parent = git(repo, 'rev-parse', '--verify', '-q', `refs/remotes/${cfg.remote}/${ref}`).out;
  const idx = path.join(cfg.state, 'work', `index-${process.pid}-${Date.now()}`);
  fs.mkdirSync(path.dirname(idx), { recursive: true });
  // the integrator's own identity on what it writes to inbox and status/digest, whatever the box's is
  const who = { GIT_AUTHOR_NAME: 'scripts/integrate.mjs', GIT_AUTHOR_EMAIL: 'integrator@localhost', GIT_COMMITTER_NAME: 'scripts/integrate.mjs', GIT_COMMITTER_EMAIL: 'integrator@localhost' };
  const env = { ...baseEnv(), ...who, GIT_INDEX_FILE: idx };
  const run = (args, input) => {
    const r = spawnSync('git', ['-C', repo, ...args], { env, encoding: 'utf8', input });
    if (r.status !== 0) throw new Error(`git ${args[0]}: ${(r.stderr || '').trim().slice(0, 200)}`);
    return (r.stdout || '').trim();
  };
  try {
    run(parent ? ['read-tree', parent] : ['read-tree', '--empty']);
    const blob = run(['hash-object', '-w', '--stdin'], text);
    run(['update-index', '--add', '--cacheinfo', `100644,${blob},${rel}`]);
    const tree = run(['write-tree']);
    const commit = run(['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', message]);
    const r = pushFastForward(ctx, ref, commit, message);
    if (r.exit !== 0) throw new Error(`the push of ${ref} failed: ${r.err}`);
    git(repo, 'update-ref', `refs/remotes/${cfg.remote}/${ref}`, commit);
    return commit;
  } finally { fs.rmSync(idx, { force: true }); }
}

// ── intake (R-1) ────────────────────────────────────────────────────────────────────────────────
const intakeFile = (cfg, key) => path.join(cfg.state, 'intake', `${key}.json`);
const inboxRef = (ctx) => `refs/remotes/${ctx.cfg.remote}/${INBOX.ref}`;
const inboxShow = (ctx, rel) => { const r = spawnSync('git', ['-C', ctx.repo, 'show', `${inboxRef(ctx)}:${rel}`], { encoding: 'utf8' }); return r.status === 0 ? r.stdout : null; };
const inboxLast = (ctx, rel) => git(ctx.repo, 'log', '-1', '--format=%H', inboxRef(ctx), '--', rel).out || null;
function parseBrief(text) {
  return {
    id: (/^# Brief: ([0-9a-z][0-9a-z.-]*)/m.exec(text) || [])[1] || null,
    tier: (/\*\*Classification: (T[123])\*\*/.exec(text) || [])[1] || null,
    question: (/^\*\*Question for the operator:\*\*\s*(.+)$/m.exec(text) || [])[1] || null,
    changes_verdict: /changes a verdict: yes/i.test(text),
    ships_publicly: !/ships publicly: no/i.test(text),
  };
}
// The next spec number: one above every number dev's specs/, the items and the intake records use.
function nextNumber(ctx) {
  const nums = [];
  const dev = `refs/remotes/${ctx.cfg.remote}/${ctx.cfg.base_ref}`;
  for (const n of git(ctx.repo, 'ls-tree', '--name-only', dev, 'specs/').out.split('\n')) { const m = /^specs\/(\d{3})/.exec(n); if (m) nums.push(Number(m[1])); }
  for (const it of ctx.items()) { const m = /^(\d{3})-/.exec(it.id); if (m) nums.push(Number(m[1])); }
  return String(Math.max(0, ...nums) + 1).padStart(3, '0');
}

// A brief session: a fresh context outside every repository, auto memory off, reading the request
// and writing one file; its cost and any usage-limit hit go to the ledger.
function briefSession(ctx, key, requestText) {
  const { cfg } = ctx;
  const lim = cfg.settings.data.brief_session;
  const dir = path.join(cfg.state, 'intake', `session-${key}-${stampOf(new Date())}`);
  fs.mkdirSync(dir, { recursive: true });
  created(ctx, dir, 'brief-session');
  const request = path.join(dir, 'request.md');
  fs.writeFileSync(request, requestText);
  const out = path.join(dir, 'brief.md');
  const prompt = [
    'DRIVER-STAGE: brief', `REQUEST-KEY: ${key}`, `REQUEST: ${request}`, `WRITE: ${out}`, `NEXT-NUMBER: ${nextNumber(ctx)}`, `CONSTITUTION: ${path.join(ROOT, 'CONSTITUTION.md')}`, '',
    'You are the integrator\'s brief writer, a fresh context. Read the request at REQUEST and the constitution\'s § Proportional oversight, and write the brief for the request to the WRITE path, and nothing else.',
    'The brief\'s first line is `# Brief: <NEXT-NUMBER>-<a short slug>`. Its next line is `**Classification: T<k>**; changes a verdict: yes|no; ships publicly: yes|no.`, by the tier table; when unsure, the higher tier. Then the request\'s goal and its acceptance lines, in plain words.',
    'When the request would change what Driftproof means, add one line `**Question for the operator:** <the question>`.',
  ].join('\n');
  const model = modelFor(BRIEF_MODEL);
  const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--max-turns', String(lim.max_turns), '--max-budget-usd', String(lim.usd),
    '--settings', JSON.stringify({ autoMemoryEnabled: false }), ...(model ? ['--model', model] : []), '--add-dir', dir, '--allowedTools', 'Read,Grep,Glob,Write'];
  const env = {};
  for (const [k, v] of Object.entries(baseEnv())) if (!/^CLAUDE/.test(k) && !/^GIT_CONFIG_(COUNT|KEY_|VALUE_)/.test(k) && k !== 'SSH_AUTH_SOCK') env[k] = v;
  env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1';
  env.GIT_CEILING_DIRECTORIES = path.dirname(dir);
  const r = spawnSync(process.env.DRIVE_CLAUDE_BIN || 'claude', args, { cwd: dir, env, encoding: 'utf8', timeout: lim.minutes * 60000, maxBuffer: 64 * 1024 * 1024 });
  fs.writeFileSync(path.join(dir, 'stream.jsonl'), r.stdout || '');
  let result = null;
  for (const l of (r.stdout || '').split('\n')) { try { const j = JSON.parse(l); if (j.type === 'result') result = j; } catch {} }
  const cost = result && typeof result.total_cost_usd === 'number' ? result.total_cost_usd : lim.usd;
  const hit = usageLimitIn(r.stdout);
  book(ctx, { key: `brief:${key}:${path.basename(dir)}`, kind: 'brief', item: null, request: key, cost_usd: cost, usage_limit: !!hit });
  if (hit) usageLimitHit(ctx, hit, path.join(dir, 'stream.jsonl'), null);
  const ok = r.status === 0 && result && result.subtype === 'success' && !result.is_error;
  let text = null;
  try { text = fs.readFileSync(out, 'utf8'); } catch {}
  return { ok, text, hit, exit: r.status, dir };
}

// One pass of intake: the operator's approvals for the briefs that wait, then each new request.
function intake(ctx, rec, { sessions }) {
  const { cfg } = ctx;
  if (!ctx.repo) ensureClone(ctx);
  rec.intake = { briefed: [], queued: [], waiting: [], parked: [], held: [] };
  if (!git(ctx.repo, 'rev-parse', '--verify', '-q', inboxRef(ctx)).out) return rec.intake;
  const now = () => ctx.clock().toISOString();
  for (const it of ctx.items().filter((i) => i.state === 'awaiting-brief-approval')) {
    const rel = `${INTAKE.approved}${it.intake_key}`;
    const at = inboxLast(ctx, rel);
    const text = at ? String(inboxShow(ctx, rel) || '') : '';
    const oneLine = text.trim() !== '' && text.replace(/\n$/, '').split('\n').length === 1;
    // an approval counts only when it was committed after the brief as the integrator last wrote it
    const after = !!(at && it.brief_commit && at !== it.brief_commit && git(ctx.repo, 'merge-base', '--is-ancestor', it.brief_commit, at).code === 0);
    if (!oneLine || !after) { rec.intake.waiting.push(it.id); continue; }
    Object.assign(it, { state: 'queued', queued_at: now(), operator_approval: { commit: at, read: now() } });
    delete it.class; delete it.reason; delete it.policy;
    ctx.save(it);
    ctx.report('intake-queued', it, { approval: at, tier: it.tier });
    rec.intake.queued.push(it.id);
  }
  const names = git(ctx.repo, 'ls-tree', '-r', '--name-only', inboxRef(ctx), '--', INTAKE.queue).out.split('\n').filter((n) => n.endsWith('.md'));
  for (const rel of names) {
    const key = path.basename(rel, '.md');
    if (!/^[0-9A-Za-z][0-9A-Za-z_-]*$/.test(key)) continue;
    const prior = readJson(intakeFile(cfg, key), null);
    // a brief written whose push was refused is pushed again with no new session; a session that
    // failed for a reason other than the usage limit is tried once more
    const resume = !!prior && prior.state === 'brief-written';
    const attempts = prior && prior.state === 'brief-failed' ? (prior.attempts || 1) : 0;
    if (prior && !resume && !(attempts && attempts < 2)) continue;
    const requestCommit = resume ? prior.request_commit : inboxLast(ctx, rel);
    let text; let brief;
    if (resume) {
      try { text = fs.readFileSync(prior.brief_file, 'utf8'); } catch { rec.intake.held.push(key); continue; }
      brief = parseBrief(text);
    } else {
      if (!sessions) { rec.intake.held.push(key); continue; }
      // every halt is read again before each session: a stop file or a quiet marker that began during
      // an earlier brief session holds the rest
      if (fs.existsSync(cfg.stop_file) || ctx.gatesHalted()) { rec.intake.held.push(key); continue; }
      const b = budgetState(ctx);
      if (b.stop) { rec.intake.held.push(key); continue; }
      const s = briefSession(ctx, key, inboxShow(ctx, rel) || '');
      brief = s.text ? parseBrief(s.text) : {};
      const taken = brief.id && (ctx.item(brief.id) || jsonl(path.join(cfg.state, 'intake', 'ids.jsonl')).some((x) => x.id === brief.id));
      if (!s.ok || !brief.id || !brief.tier || taken) {
        // a session that met the usage limit leaves the request for the next pass after the reset
        if (s.hit) { rec.intake.held.push(key); continue; }
        const why = !s.ok ? `the brief session ended with exit ${s.exit}` : !brief.id || !brief.tier ? 'the brief names no id or no tier' : `the brief's id ${brief.id} is taken`;
        const again = attempts + 1 < 2;
        writeJson(intakeFile(cfg, key), { key, state: 'brief-failed', attempts: attempts + 1, why, request_commit: requestCommit, at: now() });
        ctx.report('intake-failed', null, { request: key, why: again ? `${why}; it is tried once more on the next pass` : `${why}; to try again, commit the request under a new number` });
        rec.intake.parked.push(key);
        continue;
      }
      text = s.text;
      // the brief and its intake record are written before the push: a push refused leaves them, and
      // the next pass pushes the same brief again instead of running another session
      const file = path.join(cfg.state, 'briefs', `${brief.id}.md`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
      appendJsonl(path.join(cfg.state, 'intake', 'ids.jsonl'), { id: brief.id, key });
      writeJson(intakeFile(cfg, key), { key, id: brief.id, state: 'brief-written', brief_file: file, request_commit: requestCommit, at: now() });
    }
    const file = path.join(cfg.state, 'briefs', `${brief.id}.md`);
    let briefCommit;
    try { briefCommit = commitFile(ctx, INBOX.ref, `${INTAKE.briefs}${key}.md`, text, `intake(${brief.id}): the brief of request ${key} (scripts/integrate.mjs)`); } catch (e) {
      ctx.report('intake-error', null, { request: key, error: String(e.message).slice(0, 300) });
      rec.intake.held.push(key);
      continue;
    }
    const it = { id: brief.id, tier: brief.tier, changes_verdict: brief.changes_verdict, ships_publicly: brief.ships_publicly, brief: file, origin: 'intake', request: key, intake_key: key, request_commit: requestCommit, brief_commit: briefCommit, briefed_at: now() };
    const waits = brief.tier !== 'T3';
    if (brief.question) {
      ctx.save(it);
      park(ctx, it, null, 'question', `the brief asks the operator: ${brief.question}`, { question: brief.question });
      rec.intake.parked.push(it.id);
    } else if (waits) {
      Object.assign(it, { state: 'awaiting-brief-approval', reason: `a ${brief.tier} brief waits for the operator's approval file ${INTAKE.approved}${key} on inbox` });
      ctx.save(it);
      ctx.report('intake-waiting', it, { tier: brief.tier, approval_file: `${INTAKE.approved}${key}` });
      rec.intake.waiting.push(it.id);
    } else {
      Object.assign(it, { state: 'queued', queued_at: now() });
      ctx.save(it);
      ctx.report('intake-queued', it, { tier: brief.tier });
      rec.intake.queued.push(it.id);
    }
    writeJson(intakeFile(cfg, key), { key, id: it.id, tier: it.tier, state: it.state, request_commit: requestCommit, brief_commit: briefCommit, at: now() });
    rec.intake.briefed.push(it.id);
  }
  return rec.intake;
}

// ── the tier raise (R-3, ruling 1) ─────────────────────────────────────────────────────────────
const RANK = { T3: 0, T2: 1, T1: 2 };
// When a builder ends ready: its branch's diff from where it left dev, against the T1 table and,
// for a T3 item, the driver's T3 allowance. Returns the raise, or null when the tier stands.
function tierRaise(ctx, it) {
  const { cfg } = ctx;
  const repo = it.clone;
  const tip = git(repo, 'rev-parse', '--verify', '-q', `refs/heads/${it.branch}`).out;
  const dev = git(repo, 'rev-parse', '--verify', '-q', `refs/remotes/${cfg.remote}/${cfg.base_ref}`).out || git(repo, 'rev-parse', '--verify', '-q', `refs/heads/${cfg.base_ref}`).out;
  if (!tip || !dev) return null;
  const mb = git(repo, 'merge-base', dev, tip).out;
  const paths = git(repo, 'diff', '--name-only', mb, tip).out.split('\n').filter(Boolean);
  const t1Table = tableOf(ctx, 't1_paths');
  const t1 = paths.filter((p) => t1Table.some((re) => re.test(p)));
  const outside = it.tier === 'T3' ? outsideT3(it.id, paths) : [];
  const to = t1.length ? 'T1' : outside.length ? 'T2' : null;
  if (!to || RANK[to] <= RANK[it.tier]) return null;
  return { from: it.tier, to, paths: (t1.length ? t1 : outside).slice(0, 20), why: t1.length ? 'its diff touches the T1 table' : "its diff changes paths outside T3's", at: ctx.clock().toISOString() };
}
// A raise re-tiers the brief, commits it to inbox again, and waits for the operator; approved, the
// item is built again at its new tier in a clone of its own.
function applyRaise(ctx, it, r) {
  const { cfg } = ctx;
  const key = it.intake_key || it.id;
  let text = '';
  try { text = fs.readFileSync(it.brief, 'utf8'); } catch {}
  const line = `**Classification: ${r.to}**`;
  text = /\*\*Classification: T[123]\*\*/.test(text) ? text.replace(/\*\*Classification: T[123]\*\*/, line) : `${line}\n\n${text}`;
  text += `\n**Raised by the integrator** from ${r.from} to ${r.to}: ${r.why} (${r.paths.join(', ')}).\n`;
  const file = path.join(cfg.state, 'briefs', `${it.id}.md`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  const briefCommit = commitFile(ctx, INBOX.ref, `${INTAKE.briefs}${key}.md`, text, `intake(${it.id}): the brief of ${key} raised to ${r.to} (scripts/integrate.mjs)`);
  Object.assign(it, {
    tier: r.to, tier_from: it.tier_from || r.from, raised: [...(it.raised || []), r], brief: file, intake_key: key, brief_commit: briefCommit,
    state: 'awaiting-brief-approval', class: 'tier-raised', rebuild: (it.rebuild || 0) + 1,
    reason: `raised from ${r.from} to ${r.to}: ${r.why} (${r.paths.slice(0, 3).join(', ')}); it waits for the operator's approval file ${INTAKE.approved}${key} on inbox, then builds again at ${r.to}`,
  });
  delete it.from; delete it.branch; delete it.checks_green_at; delete it.approved_at;
  ctx.save(it);
  ctx.report('tier-raised', it, { from: r.from, to: r.to, paths: r.paths });
}

// ── retention (R-6, ruling 3) ───────────────────────────────────────────────────────────────────
function holdsEvidence(p) {
  if (p.split(path.sep).includes('evidence')) return true;
  const walk = (d, depth) => {
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return false; }
    for (const e of ents) {
      if (!e.isDirectory() || e.name === '.git' || e.name === 'node_modules') continue;
      if (e.name === 'evidence') return true;
      if (depth < 12 && walk(path.join(d, e.name), depth + 1)) return true;
    }
    return false;
  };
  try { return fs.statSync(p).isDirectory() && walk(p, 0); } catch { return false; }
}
// The branch heads of the git repositories at or just inside a path that the remote does not carry.
function unpushedBranches(ctx, p) {
  const out = [];
  let dirs = [p];
  try { if (fs.statSync(p).isDirectory()) dirs = [p, ...fs.readdirSync(p).map((n) => path.join(p, n))]; } catch { return out; }
  for (const d of dirs) {
    if (!fs.existsSync(path.join(d, '.git')) && !fs.existsSync(path.join(d, 'HEAD'))) continue;
    const top = git(d, 'rev-parse', '--absolute-git-dir').out;
    if (!top || !path.resolve(top).startsWith(path.resolve(p))) continue;
    for (const l of git(d, 'for-each-ref', '--format=%(refname:short) %(objectname)', 'refs/heads').out.split('\n').filter(Boolean)) {
      const [name, sha] = l.split(' ');
      const onRemote = git(ctx.repo, 'cat-file', '-e', `${sha}^{commit}`).code === 0 && git(ctx.repo, 'for-each-ref', '--contains', sha, '--count=1', `refs/remotes/${ctx.cfg.remote}`).out !== '';
      if (!onRemote) out.push(name);
    }
  }
  return out;
}
function retain(ctx) {
  const { cfg } = ctx;
  const s = cfg.settings.data;
  const days = s.retention_days;
  const now = ctx.clock().getTime();
  const entries = jsonl(manifestFile(cfg));
  const next = []; const candidates = []; const deleted = [];
  const keep = (e, why) => { next.push(e); if (!/^younger/.test(why)) candidates.push({ path: e.path, kind: e.kind, why }); };
  const guarded = [cfg.state, ROOT, HOME, '/', cfg.train.checkout].map((x) => path.resolve(x));
  if (!ctx.repo) ensureClone(ctx);
  for (const e of entries) {
    if (!e || !e.path || !path.isAbsolute(e.path) || !fs.existsSync(e.path)) continue;
    const ageDays = (now - Date.parse(e.created)) / DAY;
    if (ageDays < days) { keep(e, `younger than ${days} days`); continue; }
    if (guarded.some((g) => g === path.resolve(e.path) || g.startsWith(path.resolve(e.path) + path.sep))) { keep(e, 'it is or holds a directory the integrator never deletes'); continue; }
    if (holdsEvidence(e.path)) { keep(e, 'it holds an evidence directory'); continue; }
    const unpushed = unpushedBranches(ctx, e.path);
    if (unpushed.length) { keep(e, `its branch ${unpushed[0]} is not on ${cfg.remote}`); continue; }
    fs.rmSync(e.path, { recursive: true, force: true });
    deleted.push(e.path);
  }
  const tmp = `${manifestFile(cfg)}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, next.map((e) => JSON.stringify(e) + '\n').join(''));
  fs.renameSync(tmp, manifestFile(cfg));
  const rec = { at: ctx.clock().toISOString(), retention_days: days, deleted, kept_past_retention: candidates, listed: next.length };
  writeJson(path.join(cfg.state, 'retention', `${stampOf(new Date())}-${process.pid}.json`), rec);
  return rec;
}

// ── the digest (R-8) ────────────────────────────────────────────────────────────────────────────
const digestDir = (cfg) => path.join(cfg.state, 'digest');
const between = (t, from, to) => { const x = Date.parse(t); return Number.isFinite(x) && x > Date.parse(from) && x <= Date.parse(to); };
const gb = (b) => (b == null ? 'not read' : `${(b / GB).toFixed(1)} GB`);
const when = (t) => (t && Number.isFinite(Date.parse(t)) ? `${new Date(t).toISOString().slice(0, 16).replace('T', ' ')} UTC` : 'a time not recorded');
function mergePaths(ctx, sha) {
  if (!sha) return [];
  return git(ctx.repo, 'diff', '--name-only', `${sha}^1`, sha).out.split('\n').filter(Boolean);
}
function composeDigest(ctx, kind, { from, to, candidate, retention }) {
  const { cfg } = ctx;
  const s = cfg.settings.data;
  const report = jsonl(path.join(cfg.state, 'report.jsonl')).filter((r) => between(r.t, from, to));
  const L = [];
  const date = localDate(ctx, to);
  L.push(kind === 'release' ? `# Integrator release digest, ${date}: the candidate ${short(candidate)}` : `# Integrator digest, ${date}`, '');
  const health = healthNow(ctx);
  if (health.disk.low || health.memory.low) {
    if (health.disk.low) L.push(health.disk.bytes == null ? '**Warning:** free disk could not be read. No new builder starts until it can be.' : `**Warning:** free disk is ${gb(health.disk.bytes)}, under the ${s.health.disk_free_gb} GB threshold. No new builder starts until it is above it.`);
    if (health.memory.low) L.push(health.memory.bytes == null ? '**Warning:** available memory could not be read. No new builder starts until it can be.' : `**Warning:** available memory is ${gb(health.memory.bytes)}, under the ${s.health.memory_available_gb} GB threshold. No new builder starts until it is above it.`);
    L.push('');
  }
  L.push(Date.parse(from) > 0 ? `This covers ${when(from)} to ${when(to)}.` : `This covers everything the integrator recorded up to ${when(to)}.`, '');
  const merged = report.filter((r) => r.kind === 'merged');
  if (kind === 'release') {
    const t1 = tableOf(ctx, 't1_paths'); const pub = tableOf(ctx, 'public_text_paths');
    const merges = fs.existsSync(path.join(cfg.state, 'merges')) ? fs.readdirSync(path.join(cfg.state, 'merges')).filter((n) => n.endsWith('.json')).map((n) => readJson(path.join(cfg.state, 'merges', n))).filter((m) => m && m.status === 'merged' && between(m.ended || m.started, from, to)) : [];
    const amended = merges.flatMap((m) => (m.steps || []).filter((x) => x.step === 'amendment').map((x) => `- ${m.item}: ${(x.amended || []).join('; ')}; the separate agreement ${x.agreement && x.agreement.agrees ? 'agreed' : 'did not agree'}${x.agreement && x.agreement.record ? ` (${x.agreement.record})` : ''}.`));
    const touched = merged.map((r) => ({ r, paths: mergePaths(ctx, r.merge_commit) }));
    const lines = (re) => touched.map(({ r, paths }) => ({ r, hit: paths.filter((p) => re.some((x) => x.test(p))) })).filter((x) => x.hit.length).map(({ r, hit }) => `- ${r.item} (merge ${short(r.merge_commit)}): ${hit.join(', ')}.`);
    const flakes = jsonl(path.join(cfg.state, 'flakes.jsonl')).filter((f) => between(f.t, from, to)).map((f) => `- the gate ${f.gate} at ${when(f.t)}${f.item ? `, merging ${f.item}` : ''}${f.nightly ? ', in the nightly' : ''}: red, then green on its rerun.`);
    const none = (a) => (a.length ? a : ['- None recorded.']);
    L.push("## For the operator's review at the go", '');
    L.push('### Gate amendments and re-baselines', '', ...none(amended), '');
    L.push('### Changes that can alter a receipt, verdict, badge or decide', '', ...none(lines(t1)), '');
    L.push('### Flakes', '', ...none(flakes), '');
    L.push('### Public text changes', '', ...none(lines(pub)), '');
  }
  L.push('## Merged', '', ...(merged.length ? merged.map((r) => `- ${r.item} onto ${cfg.staging} at ${short(r.merge_commit)}, ${when(r.t)}.`) : ['- Nothing merged.']), '');
  const parkedBy = new Map();
  for (const r of report.filter((x) => ['parked', 'sent-back', 'intake-failed'].includes(x.kind))) parkedBy.set(r.item || `request ${r.request}`, r);
  L.push('## Parked, and why', '', ...(parkedBy.size ? [...parkedBy].map(([id, r]) => `- ${id} (${r.class || r.kind}): ${String(r.reason || r.why || '').slice(0, 400)}`) : ['- Nothing parked.']), '');
  const questions = [
    ...ctx.items().filter((i) => i.state === 'parked' && ['question', 'operator-ruling'].includes(i.class)).map((i) => `- ${i.id}: ${i.question || i.reason}`),
    ...report.filter((r) => r.kind === 'nightly-stop').map((r) => `- The nightly's culprit search stopped on ${r.gate}: ${r.why}. Nothing moved.`),
  ];
  L.push('## Questions for the operator', '', ...(questions.length ? questions : ['- None.']), '');
  const ledger = jsonl(ledgerFile(cfg));
  const period = ledger.filter((x) => between(x.t, from, to));
  const b = budgetState(ctx);
  const stops = report.filter((r) => ['budget-stop', 'usage-limit'].includes(r.kind)).map((r) => (r.kind === 'usage-limit' ? `a session met the usage limit at ${when(r.t)}; no session starts until ${r.resets_at ? when(r.resets_at) : 'the operator clears it'}` : `the daily cap was reached on the budget day ${r.day}`));
  L.push('## Cost', '',
    `- This period: ${period.reduce((t, x) => t + (Number(x.cost_usd) || 0), 0).toFixed(2)} USD over ${period.length} session(s) (${['builder', 'brief', 'agreement'].map((k) => `${period.filter((x) => x.kind === k).length} ${k}`).join(', ')}).`,
    `- The budget day ${b.day} (from ${s.budget.day_starts} at ${s.budget.zone}): ${b.spent.toFixed(2)} USD of the daily cap of ${pos(b.cap) ? `${b.cap.toFixed(2)} USD` : 'no cap (not filled in)'}.`,
    ...(stops.length ? stops.map((x) => `- Budget stop: ${x}.`) : ['- No budget stop in this period.']), '');
  const items = ctx.items();
  const ids = (st) => items.filter((i) => i.state === st).map((i) => i.id);
  const c = readJson(candidateFile(cfg), null);
  L.push('## What runs next', '',
    `- Queued for a builder: ${ids('queued').join(', ') || 'none'}.`,
    `- Building: ${ids('building').join(', ') || 'none'}.`,
    `- Waiting for the operator's approval on inbox: ${items.filter((i) => i.state === 'awaiting-brief-approval').map((i) => `${i.id} (${INTAKE.approved}${i.intake_key})`).join(', ') || 'none'}.`,
    `- Approved, waiting to merge onto ${cfg.staging}: ${ids('approved').join(', ') || 'none'}.`,
    `- The train: ${c ? `the candidate ${short(c.sha)} for ${c.cutoff_for}, ${c.phase}` : 'no candidate yet'}; the next cutoff is ${CUTOFF} UTC (${String((Number(CUTOFF.slice(0, 2)) + 8) % 24).padStart(2, '0')}${CUTOFF.slice(2)} SGT).`,
    `- The next daily digest: ${s.digest.daily_at ? `${s.digest.daily_at} at ${s.budget.zone}` : 'none, the daily digest is off'}.`, '');
  const cpu = jsonl(path.join(cfg.state, 'health', 'cpu.jsonl'));
  const night = cpu.length ? cpu[cpu.length - 1].night : null;
  const samples = cpu.filter((x) => x.night === night).map((x) => x.busy_pct);
  const cand = (retention && retention.kept_past_retention) || [];
  L.push('## Box health', '',
    `- Free disk: ${gb(health.disk.bytes)} (threshold ${s.health.disk_free_gb} GB).`,
    `- Available memory: ${gb(health.memory.bytes)} (threshold ${s.health.memory_available_gb} GB).`,
    samples.length ? `- CPU during the nightly of ${night}: average ${Math.round(samples.reduce((t, x) => t + x, 0) / samples.length)}%, peak ${Math.max(...samples)}%, from ${samples.length} sample(s).` : '- CPU during the nightly: not recorded.',
    `- Cleanup candidates: ${cand.length} artefact(s) kept past the ${s.retention_days}-day retention, for the operator${cand.length ? ':' : '.'}`,
    ...cand.map((x) => `  - ${x.path} (${x.kind}): ${x.why}.`),
    `- Retention deleted ${retention ? retention.deleted.length : 0} artefact(s) the integrator made${retention && retention.deleted.length ? `: ${retention.deleted.slice(0, 10).join(', ')}` : ''}.`, '');
  return L.join('\n');
}
// The digest as it is committed: home paths as ~, no em dash, and any line the hygiene scan finds a
// hit in withheld, naming the hit. A scan that cannot be loaded refuses the digest: it is never
// committed unscanned (NFR-5).
function cleanDigest(text) {
  let t = String(text).split(HOME).join('~').replace(/\u2014/g, ',');
  let scan = null;
  try { scan = createRequire(import.meta.url)(path.join(ROOT, 'lib', 'hygiene.js')).scanContent; } catch {}
  if (typeof scan !== 'function') throw new Error('lib/hygiene.js could not be loaded, so the digest is not committed unscanned');
  return t.split('\n').map((l) => { const h = scan('digest.md', l); return h.length ? `- [a line is withheld: the hygiene scan found ${[...new Set(h.map((x) => x.kind))].join(', ')} in it]` : l; }).join('\n');
}
function writeDigest(ctx, kind, sha = null) {
  const { cfg } = ctx;
  if (!ctx.repo) ensureClone(ctx);
  syncLedger(ctx);
  const to = ctx.clock().toISOString();
  const lastFile = path.join(digestDir(cfg), `last-${kind}.json`);
  const last = readJson(lastFile, null);
  const from = last ? last.at : kind === 'daily' ? new Date(Date.parse(to) - DAY).toISOString() : new Date(0).toISOString();
  const candidate = kind === 'release' ? (sha || (readJson(candidateFile(cfg), {}) || {}).sha || gitOk(ctx.repo, 'rev-parse', `refs/remotes/${cfg.remote}/${cfg.staging}`)) : null;
  const retention = kind === 'daily' ? retain(ctx) : null;
  const text = cleanDigest(composeDigest(ctx, kind, { from, to, candidate, retention }));
  const date = localDate(ctx, to);
  const rel = kind === 'daily' ? `digests/${date}-daily.md` : `digests/${date}-release-${short(candidate)}.md`;
  const commit = commitFile(ctx, 'status/digest', rel, `${text}\n`, `digest(${date}): the ${kind} digest (scripts/integrate.mjs)`);
  writeJson(lastFile, { at: to, date, rel, commit, candidate });
  ctx.report('digest', null, { kind, rel, commit });
  return { kind, rel, commit };
}
// The service's digests: the daily one at the first pass at or after its time on a day that has
// none, and the release one once the train has staged a candidate that has none.
function digestsDue(ctx) {
  const { cfg } = ctx;
  const d = cfg.settings.data.digest;
  const now = ctx.clock().toISOString();
  const out = [];
  const lastDaily = readJson(path.join(digestDir(cfg), 'last-daily.json'), null);
  if (d.daily_at && localTime(ctx, now) >= d.daily_at && (!lastDaily || lastDaily.date !== localDate(ctx, now))) out.push(writeDigest(ctx, 'daily'));
  const c = readJson(candidateFile(cfg), null);
  const lastRelease = readJson(path.join(digestDir(cfg), 'last-release.json'), null);
  if (d.on_release && c && ['staged', 'go-held', 'released'].includes(c.phase) && (!lastRelease || lastRelease.candidate !== c.sha)) out.push(writeDigest(ctx, 'release', c.sha));
  return out;
}
async function digestCmd(cfg, opts) {
  const probs = settingsProblems(cfg).filter((p) => !p.startsWith('budget.daily_usd'));
  if (probs.length) { process.stderr.write(`integrate: digest refused (settings): ${probs.join('; ')}\n`); return 5; }
  const ctx = context(cfg, opts);
  const r = writeDigest(ctx, opts.release ? 'release' : 'daily');
  process.stdout.write(`integrate: digest ${r.kind}: ${r.rel} at ${short(r.commit)} on status/digest\n`);
  return 0;
}

// ── the commands ────────────────────────────────────────────────────────────────────────────────
async function tick(cfg, opts) {
  const ctx = context(cfg, opts);
  const rec = ctx.record;
  const recFile = path.join(cfg.state, 'ticks', `${stampOf(new Date())}-${process.pid}.json`);
  // spec 068 R-5: no settings, or no daily cap, and the integrator does not start
  const unset = refusedBySettings(cfg, 'tick');
  if (unset) {
    rec.refused = { kind: 'settings', detail: unset.join('; ') };
    writeJson(recFile, rec);
    return 5;
  }
  created(ctx, recFile, 'record');
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
  // spec 068 R-4 and R-7: the ledger, the day's spend and any usage-limit stop, and box health. A
  // budget stop ends running builders for the same resume the quiet marker uses.
  syncLedger(ctx);
  rec.budget = budgetState(ctx);
  const health = healthNow(ctx);
  rec.health = { disk_free_bytes: health.disk.bytes, mem_available_bytes: health.memory.bytes, low: health.low };
  if (rec.budget.stop && !noGates) rec.stopped_builders = await stopBuilders(ctx, `the budget guard: ${rec.budget.stop.why}`);
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
  // spec 068 R-1: intake reads approvals whenever gates may run, and starts brief sessions only when
  // sessions may start
  if (!noGates && !hold) {
    try { intake(ctx, rec, { sessions: !noSessions && !budgetState(ctx).stop }); } catch (e) { rec.intake_error = e.message; ctx.report('intake-error', null, { error: e.message.slice(0, 300) }); }
  }
  rec.started_builders = [];
  const held = budgetState(ctx).stop;
  if (held) rec.budget.stop = held;
  if (!noSessions && !held && health.low.length) {
    rec.health_held = health.low;
    const f = path.join(cfg.state, 'health', 'held.jsonl');
    const day = ctx.clock().toISOString().slice(0, 10);
    if (!jsonl(f).some((x) => x.day === day)) { appendJsonl(f, { day, low: health.low }); ctx.report('health-low', null, { low: health.low }); }
  }
  if (!noSessions && !held && !health.low.length) {
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
  process.stdout.write(`integrate: tick at ${rec.now}: halts ${JSON.stringify(halts)}; collected ${rec.collected.length}; ${rec.merge ? `merge ${rec.merge.item} ${rec.merge.outcome}` : 'no merge'}; started ${rec.started_builders.join(', ') || 'none'}${rec.intake ? `; intake briefed ${rec.intake.briefed.length}, queued ${rec.intake.queued.length}` : ''}${rec.budget.stop ? `; budget stop (${rec.budget.stop.kind})` : ''}${health.low.length ? `; box health low: ${health.low.join(', ')}` : ''}\n`);
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
  if (refusedBySettings(cfg, 'train')) return 5;
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
  if (!fs.existsSync(dir)) created(ctx, dir, 'staged-build');
  const version = c.version || 'unversioned';
  const message = `Driftproof ${version}: the release candidate, staged by the train and held for the operator's go.`; // no private SHA: a public message is read for one (spec 113)
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
    `the public push, by RUNBOOK § Publish to npm: rebuild into the default target with build-public.sh (-F the release notes), then node scripts/push-public.mjs (a plain fast-forward; the staged tree is a root commit kept for its checks and is never pushed)`,
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
  const unset = settingsProblems(cfg);
  if (unset.length) { pass.halted = `refused (settings): ${unset.join('; ')}`; done(); return; }
  created(ctx, file, 'record');
  const policy = readIntegratorPolicy(cfg);
  if (!policy.ok) { pass.halted = `refused (${policy.kind})`; done(); return; }
  ctx.policy = policy;
  // spec 068 R-7: CPU while the nightly's window is open
  pass.cpu = sampleCpu(ctx);
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
  // spec 068 R-8: the daily digest at its time, and the release digest once a candidate is staged
  try { pass.digests = digestsDue(ctx); } catch (e) { pass.digest_error = e.message; ctx.report('digest-error', null, { error: e.message.slice(0, 300) }); }
  done();
}

// `serve`: the service's loop. SIGTERM ends it after the current pass.
async function serve(cfg, opts) {
  if (refusedBySettings(cfg, 'serve')) return 5;
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
  // spec 068 ruling 2: the integrator refuses to switch on until the operator fills in the cap
  if (refusedBySettings(cfg, 'pin-policy')) return 5;
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
  if (!['tick', 'nightly', 'train', 'serve', 'digest', 'pin-policy', 'status'].includes(cmd) || !file) {
    process.stderr.write('usage: node scripts/integrate.mjs tick <config.json> [--now <iso>] [--wait]\n       node scripts/integrate.mjs nightly <config.json> --result <sweep-run.json> [--now <iso>]\n       node scripts/integrate.mjs train <config.json> [--now <iso>]\n       node scripts/integrate.mjs serve <config.json> [--now <iso>] [--passes <n>] [--interval-seconds <s>]\n       node scripts/integrate.mjs digest <config.json> [--release] [--now <iso>]\n       node scripts/integrate.mjs pin-policy <config.json>\n       node scripts/integrate.mjs status <config.json>\n');
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
  if (cmd === 'digest') return digestCmd(cfg, { now: opt('--now'), release: rest.includes('--release') });
  if (cmd === 'serve') return serve(cfg, { now: opt('--now'), passes: opt('--passes'), interval: opt('--interval-seconds') });
  return tick(cfg, { now: opt('--now'), wait: rest.includes('--wait') });
}

main(process.argv.slice(2)).then((code) => process.exit(code), (e) => { process.stderr.write(`integrate: ${e.stack || e.message}\n`); process.exit(1); });
