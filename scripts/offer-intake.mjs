#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Issue 781 (spec 781): the free offer's intake, run by the controller. It holds no credential and posts
// nothing: it reads an issue list the controller exported, numbers the requests, pins each repository at a
// commit, applies the text-only rule, writes a frozen plan per request under the USD 50 cap, runs the
// zero-cost preflight, reads a finished campaign into the request page's view, and prepares the issue
// comments for the controller to post.
//
//   gh issue list --repo driftproofhq/driftproof --label offer --state all --limit 500 \
//     --json number,title,body,labels,state,url,createdAt > /var/tmp/offer-issues.json
//   node scripts/offer-intake.mjs queue --issues /var/tmp/offer-issues.json --as-of YYYY-MM-DD [--comments /var/tmp/offer-comments.json]
//   node scripts/offer-intake.mjs pin --issues /var/tmp/offer-issues.json --request N
//   (draft the three tasks of each suite under the request's specs/408-skill-measurements/suites/)
//   node scripts/offer-intake.mjs plan --request N
//   node scripts/offer-intake.mjs inputs --request N --out /var/tmp/offer-NNN-inputs
//   node scripts/offer-intake.mjs preflight --request N --inputs /var/tmp/offer-NNN-inputs
//   node specs/781-free-offer/run-campaign.cjs --request specs/781-free-offer/requests/NNN --campaign-root receipts/offer/NNN --inputs ... --plan-sha256 H --execute
//   node scripts/offer-intake.mjs publish --request N --campaign-root receipts/offer/NNN [--comments FILE]
//   node scripts/offer-intake.mjs rerun --model <model id>
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const O = require('./offer.js');
const { sha256 } = require('../lib/canonical');
const { parseSkillMeta } = require('../lib/skill');
const P = require('../specs/781-free-offer/protocol.cjs');
const B = require('../specs/781-free-offer/build-plan.cjs');
const R = () => require('../specs/781-free-offer/run-campaign.cjs');
export const REQUESTS = path.join(ROOT, 'specs/781-free-offer/requests');
export const QUEUE = path.join(ROOT, 'docs/data/offer-queue.json');

const fail = (code) => { throw Object.assign(new Error(code), { code }); };
const need = (ok, code) => { if (!ok) fail(code); };
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 2) + '\n'); };
const dirOf = (requests, n) => path.join(requests, O.pad(n));
const defaultRemote = (repo) => `https://github.com/${repo}.git`;
// Nothing the intake prepares for the controller is written into the tree (CLAUDE.md).
const outside = (f) => { const r = path.relative(ROOT, path.resolve(f)); need(r.startsWith('..') || path.isAbsolute(r), 'OUTPUT_IN_TREE'); return f; };

// ── git, as the pinned repository serves it; no code from it is run ──
function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, maxBuffer: 1 << 28, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  if (r.status !== 0) fail('GIT_FETCH');
  return r.stdout;
}
function fetchAt(url, commit = null) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'offer-fetch-'));
  git(dir, 'init', '-q', '--bare');
  git(dir, '-c', 'protocol.version=2', 'fetch', '-q', '--depth', '1', url, commit || 'HEAD');
  const got = git(dir, 'rev-parse', 'FETCH_HEAD').toString().trim();
  need(/^[0-9a-f]{40}$/.test(got) && (!commit || got === commit), 'COMMIT_PIN');
  return { dir, commit: got, blob: (p) => git(dir, 'cat-file', 'blob', `${got}:${p}`), tree: (p) => git(dir, 'ls-tree', '-r', '-z', '--full-tree', got, '--', p).toString().split('\0').filter(Boolean).map((l) => { const m = /^(\d+) (\w+) [0-9a-f]+\t([\s\S]+)$/.exec(l); return { mode: m[1], type: m[2], path: m[3] }; }) };
}

// ── the queue (AC-9, AC-16) and the comments (AC-17) ──
export function records(requests = REQUESTS) {
  const out = {};
  if (!fs.existsSync(requests)) return out;
  for (const d of fs.readdirSync(requests)) {
    const f = path.join(requests, d, 'request.json');
    if (/^\d{3}$/.test(d) && fs.existsSync(f)) { const r = readJson(f); out[r.request] = { state: r.state === 'published' ? 'published' : 'running' }; }
  }
  return out;
}
export function queue({ issues, previous = fs.existsSync(QUEUE) ? readJson(QUEUE) : null, requests = REQUESTS, asOf, out = QUEUE }) {
  need(/^\d{4}-\d{2}-\d{2}$/.test(String(asOf)), 'AS_OF');
  const q = O.queueOf({ issues, previous, records: records(requests), asOf });
  if (out) writeJson(out, q);
  return { queue: q, comments: O.commentsFor(previous, q) };
}

// ── one request's pins: the commit, each skill's bytes and folder, the README, the text-only rule ──
export function pin({ requests = REQUESTS, entry, issue, remote = defaultRemote }) {
  need(entry && entry.state === 'queued' && Number.isInteger(entry.request), 'NOT_QUEUED');
  const parsed = O.parseIssue(issue);
  need(!parsed.problem && parsed.repository === entry.repository, 'ISSUE_BINDING');
  const dir = dirOf(requests, entry.request);
  need(!fs.existsSync(path.join(dir, 'request.json')), 'REQUEST_PINNED');
  const repo = fetchAt(remote(entry.repository));
  const rootFiles = repo.tree('.').filter((f) => !f.path.includes('/'));
  const readme = rootFiles.find((f) => /^readme(?:\.md|\.markdown|\.txt)?$/i.test(f.path));
  const readmeBytes = readme ? repo.blob(readme.path) : null;
  const [owner, name] = entry.repository.split('/');
  const skills = [], sources = [];
  for (const skillPath of parsed.skills) {
    let bytes;
    try { bytes = repo.blob(skillPath); } catch { skills.push({ skill: path.basename(path.dirname(skillPath)), skill_path: skillPath, measurable: false, reason: 'The repository has no file at this path.' }); continue; }
    const text = bytes.toString('utf8');
    let meta = null; try { meta = parseSkillMeta(text); } catch { meta = null; }
    const skill = meta && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(meta.name || '') ? meta.name : null;
    if (!skill) { skills.push({ skill: path.basename(path.dirname(skillPath)), skill_path: skillPath, measurable: false, reason: 'Its front matter names no skill.' }); continue; }
    if (skills.some((s) => s.skill === skill)) { skills.push({ skill, skill_path: skillPath, measurable: false, reason: 'The request names this skill twice.' }); continue; }
    // The skill's folder, named relative to itself (F-1): a skill at the root reads the root, `.`, whose
    // paths carry no prefix to cut. `.git/` is never listed; each file's bytes go to the rule.
    const folder = path.posix.dirname(skillPath);
    const files = repo.tree(folder).filter((f) => f.type === 'blob')
      .map((f) => ({ mode: f.mode, path: folder === '.' ? f.path : f.path.slice(folder.length + 1), full: f.path }))
      .filter((f) => !/^\.git(?:\/|$)/.test(f.path))
      .map((f) => ({ mode: f.mode, path: f.path, bytes: repo.blob(f.full) }));
    const rule = O.textOnly({ name: skill, text, files });
    skills.push({ skill, skill_path: skillPath, measurable: rule.measurable, reason: rule.reason });
    if (!rule.measurable) continue;
    const suite = `suites/${owner}--${name}--${skill}.json`;
    const source = { repository: entry.repository, skill, commit: repo.commit, skill_path: skillPath, skill_url: `https://raw.githubusercontent.com/${entry.repository}/${repo.commit}/${skillPath}`, skill_sha256: sha256(bytes), readme_url: readme ? `https://raw.githubusercontent.com/${entry.repository}/${repo.commit}/${readme.path}` : null, readme_sha256: readmeBytes ? sha256(readmeBytes) : null, suite };
    sources.push(source);
    const challenge = parsed.kind === 'challenge';
    writeJson(path.join(B.bindingDir(dir), suite), {
      author: 'Driftproof', ...(challenge ? { tasks_by: 'requester' } : {}),
      repository: source.repository, skill_path: skillPath, commit: repo.commit, skill_sha256: source.skill_sha256, readme_sha256: source.readme_sha256,
      scope: 'Written responses only. No tool execution, installed dependencies or network access are tested.',
      drafted_from: challenge ? `The requester's three tasks, issue ${entry.issue}, word for word` : '',
      ...(challenge ? {} : { drafted: false }),
      cases: O.OFFER.taskIds.map((id, k) => ({ id, prompt: challenge ? parsed.tasks[k].prompt : '', rubric: challenge ? parsed.tasks[k].rubric : '', pass_threshold: 0.75, origin: challenge ? `Written by the requester in issue ${entry.issue}; not edited by Driftproof.` : 'Driftproof-authored from the pinned SKILL.md and README; no separate drafting model call.' })),
    });
  }
  writeJson(path.join(B.bindingDir(dir), 'sources.json'), sources);
  writeJson(path.join(dir, 'prior-spend.json'), { corrections: [] });
  const page = parsed.kind === 'challenge' ? /^\/measure\/requests\/(\d{3})\/?$/.exec(parsed.result_page) : null;
  writeJson(path.join(dir, 'request.json'), {
    request: entry.request, issue: entry.issue, url: entry.url, kind: parsed.kind, repository: entry.repository, commit: repo.commit, author: parsed.author,
    skills, challenge: parsed.kind === 'challenge' ? { result_page: parsed.result_page, skill: skills[0] && skills[0].skill, of_request: page ? Number(page[1]) : null } : null,
    state: 'pinned',
  });
  fs.rmSync(repo.dir, { recursive: true, force: true });
  return dir;
}

// ── the plan (AC-6, AC-7, AC-8): refused over the cap, and then nothing is written ──
export function plan({ request, models = P.MODELS, out = null }) {
  const p = B.buildPlan({ root: ROOT, request, models });
  const file = out || path.join(request, 'plan.json');
  writeJson(file, p);
  if (!out) { const rec = readJson(path.join(request, 'request.json')); if (rec.state === 'pinned') { rec.state = 'planned'; writeJson(path.join(request, 'request.json'), rec); } }
  return p;
}
// The run's inputs: each attempt's pinned SKILL.md bytes, fetched again at the pinned commit and checked.
export function inputs({ request, out, remote = defaultRemote, file = null }) {
  const p = readJson(file || path.join(request, 'plan.json'));
  const repo = fetchAt(remote(p.repository), p.commit);
  fs.mkdirSync(out, { recursive: true });
  for (const a of p.execution.attempts) {
    const bytes = repo.blob(a.protocol.skill_path);
    need(sha256(bytes) === a.protocol.skill_sha256, 'SKILL_BYTES');
    fs.writeFileSync(path.join(out, a.attempt_id + '.md'), bytes);
  }
  fs.rmSync(repo.dir, { recursive: true, force: true });
  return p.execution.attempts.length;
}
// The zero-cost preflight, offline: spec 408's guard replaces every provider, subprocess and network door.
export function preflight({ request, inputs: dir }) {
  process.env.DRIFTPROOF_STUB = '1';
  require('../specs/408-skill-measurements/offline-guard.cjs').install();
  return R().preflight(R().readPlan({ request }), dir);
}
// A finished campaign, read through the driver's publication rule into the page's view; the request
// is then published and the builder renders it.
export function publish({ request, campaignRoot, reader, recordedHeads, root = ROOT, requests = path.dirname(request) }) {
  const resolve = (n) => { const d = dirOf(requests, n), r = readJson(path.join(d, 'request.json')); need(r.state === 'published' && r.campaign_root, 'ORIGINAL_UNPUBLISHED'); return { request: d, campaignRoot: path.join(ROOT, r.campaign_root), reader, recordedHeads }; };
  const view = R().view({ root, request, campaignRoot, reader, recordedHeads, requests: resolve });
  const rec = readJson(path.join(request, 'request.json'));
  rec.state = 'published'; rec.campaign_root = path.relative(ROOT, path.resolve(campaignRoot)).split(path.sep).join('/');
  writeJson(path.join(request, 'request.json'), rec);
  return view;
}
// Re-run on a new model (AC-17): every published request re-planned on the model alone; a plan whose
// estimate passes the cap is refused and stops for Maverick.
export function rerun({ requests = REQUESTS, model }) {
  const out = [];
  if (!fs.existsSync(requests)) return out;
  for (const d of fs.readdirSync(requests).filter((x) => /^\d{3}$/.test(x)).sort()) {
    const dir = path.join(requests, d), rec = readJson(path.join(dir, 'request.json'));
    if (rec.state !== 'published') continue;
    try { const p = plan({ request: dir, models: [model], out: path.join(dir, `plan-${model}.json`) }); out.push({ request: rec.request, status: 'planned', estimate_usd: p.totals.estimate_usd }); }
    catch (e) { out.push({ request: rec.request, status: e.code || 'PLAN_FAILED' }); }
  }
  return out;
}

function main(argv) {
  const [cmd, ...rest] = argv, o = {};
  for (let i = 0; i < rest.length; i += 2) { need(/^--[a-z-]+$/.test(rest[i]) && rest[i + 1] !== undefined, 'ARGUMENT'); o[rest[i].slice(2)] = rest[i + 1]; }
  const reqDir = () => { need(/^\d+$/.test(o.request || ''), 'ARGUMENT'); return dirOf(REQUESTS, Number(o.request)); };
  if (cmd === 'queue') {
    const r = queue({ issues: readJson(o.issues), asOf: o['as-of'] });
    if (o.comments) writeJson(outside(o.comments), r.comments);
    console.log(`offer queue: ${r.queue.count} of ${r.queue.limit} requests numbered; ${r.queue.requests.filter((x) => x.state === 'queued').length} queued; ${r.comments.length} comments prepared, none posted`);
  } else if (cmd === 'pin') {
    const q = readJson(QUEUE), entry = q.requests.find((x) => x.request === Number(o.request));
    const issue = readJson(o.issues).find((x) => entry && x.number === entry.issue);
    const dir = pin({ entry, issue });
    const rec = readJson(path.join(dir, 'request.json'));
    console.log(`offer request ${O.pad(rec.request)} pinned at ${rec.commit}: ${rec.skills.filter((s) => s.measurable).length} text-only, ${rec.skills.filter((s) => !s.measurable).length} not measurable; draft the suites, then plan`);
  } else if (cmd === 'plan') {
    const p = plan({ request: reqDir(), ...(o.model ? { models: [o.model], out: path.join(reqDir(), `plan-${o.model}.json`) } : {}) });
    console.log(B.line(p));
  } else if (cmd === 'inputs') {
    console.log(`offer request ${O.pad(Number(o.request))}: ${inputs({ request: reqDir(), out: outside(o.out) })} inputs written, each the pinned bytes`);
  } else if (cmd === 'preflight') {
    const r = preflight({ request: reqDir(), inputs: o.inputs });
    for (const row of r.rows) console.log(`${row.status} ${row.skill} ${row.attempt_id}`);
    console.log(`offer preflight: ${r.rows.filter((x) => x.status === 'ok').length}/${r.rows.length} ok; no model called`);
    if (r.problem) process.exitCode = 1;
  } else if (cmd === 'publish') {
    const v = publish({ request: reqDir(), campaignRoot: path.resolve(o['campaign-root']) });
    console.log(`offer request ${O.pad(v.request.request)} published: ${v.skills.length} skills, ${v.skills.reduce((n, s) => n + s.boxes.length, 0)} boxes; rebuild with node scripts/build-measure.js`);
  } else if (cmd === 'rerun') {
    for (const r of rerun({ model: o.model })) console.log(`request ${O.pad(r.request)}: ${r.status}${r.estimate_usd !== undefined ? ` (estimate USD ${r.estimate_usd.toFixed(4)})` : ''}`);
  } else fail('ARGUMENT');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(`offer-intake: refused: ${e.code || e.message}`); process.exitCode = 1; }
}
