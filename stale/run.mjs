#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// stale/run.mjs - the step body of the staleness-check Action, stale/action.yml (spec 057).
//
// It runs `driftproof stale --json` from the driftproof tree this action ships in, so the version is
// the one the workflow pinned with `uses:`. It writes a job summary, keeps one labelled issue in
// step with the result, and sets the job's exit code.
//
// Every input arrives as an environment variable, INPUT_<NAME>, set by action.yml's env: block. None
// is ever parsed by a shell: `stale` and `npm` are spawned with an argument array, and the GitHub API
// is called with fetch. Receipt paths, skill names and reasons come from the user's repository, so
// they reach markdown as code spans or escaped cells, and stale's own text reaches the log between
// ::stop-commands:: markers, where a line in it cannot act as a workflow command.
//
//   result    current  every receipt current, no advisory          (stale exit 0)
//             advisory nothing stale; an axis unknown or an advisory (stale exit 3)
//             stale    a receipt needs a rerun or a regrade          (stale exit 1; --strict adds 3)
//             error    an input, a receipt, npm or the API failed    (stale exit 2, or before stale)
//
// The issue is open exactly while the result is stale. An error leaves it as it was. The job fails
// on an error, or on stale when fail-on-stale is true, and on nothing else.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(ROOT, 'bin', 'driftproof');
const env = process.env;
const WS = env.GITHUB_WORKSPACE || process.cwd();
const RESULT_OF_EXIT = { 0: 'current', 1: 'stale', 2: 'error', 3: 'advisory' };
const VERSION_RE = /^\d+\.\d+\.\d+[0-9A-Za-z.+-]*$/;
const LABEL_RE = /^[A-Za-z0-9][A-Za-z0-9 ._:/-]{0,49}$/;
// As lib/stale.js names a receipt's harness when it records none (spec 053 R-5).
const SURFACE_HARNESS = { 'claude-cli': 'claude-code', 'openai-cli': 'codex', api: 'api', 'openai-api': 'api' };

class Refusal extends Error {}
const refuse = (msg) => { throw new Refusal(msg); };

// ── the log and the step's files ─────────────────────────────────────────────
// A workflow command's data escapes %, CR and LF, so a message stays on its one line.
const annotate = (kind, msg) => process.stdout.write(`::${kind}::${String(msg).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')}\n`);
function quietly(text) {
  if (!text) return;
  const token = crypto.randomBytes(16).toString('hex');
  process.stdout.write(`::stop-commands::${token}\n${text}${text.endsWith('\n') ? '' : '\n'}::${token}::\n`);
}
function setOutputs(o) {
  if (!env.GITHUB_OUTPUT) return;
  fs.appendFileSync(env.GITHUB_OUTPUT, Object.entries(o).map(([k, v]) => `${k}=${String(v == null ? '' : v).replace(/[\r\n]/g, ' ')}\n`).join(''));
}
const addSummary = (md) => { if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, md); };

// ── inputs ───────────────────────────────────────────────────────────────────
const input = (name) => env[`INPUT_${name.toUpperCase().replace(/-/g, '_')}`] || '';
function bool(name) {
  const v = input(name).trim();
  if (v !== 'true' && v !== 'false') refuse(`input ${name} must be true or false`);
  return v === 'true';
}
function harnessMode(v) {
  if (v === 'none') return { mode: 'none' };
  if (v === 'latest') return { mode: 'latest' };
  if (VERSION_RE.test(v)) return { mode: 'fixed', version: v };
  return refuse('input harness-version must be a version such as 2.1.280, latest, or none');
}
function readInputs() {
  const inputs = {
    receipts: input('receipts').split('\n').map((s) => s.trim()).filter(Boolean),
    skill: input('skill').trim(), suite: input('suite').trim(), model: input('model').trim(), judge: input('judge').trim(),
    harness: harnessMode(input('harness-version').trim()),
    strict: bool('strict'), failOnStale: bool('fail-on-stale'), openIssue: bool('open-issue'),
    label: input('issue-label').trim(), token: input('github-token'),
  };
  if (!inputs.receipts.length) refuse('input receipts is empty; give a glob such as receipts/**/*.json');
  if (!LABEL_RE.test(inputs.label)) refuse('input issue-label must be one line of letters, digits, spaces and . _ : / -, at most 50 characters');
  if (inputs.openIssue) {
    if (!inputs.token || /\s/.test(inputs.token)) refuse('open-issue is true, so github-token must be a token (the default is the workflow\'s own)');
    if (!/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY || '')) refuse('GITHUB_REPOSITORY is not owner/name');
  }
  return inputs;
}

// ── receipts: the globs, from the workspace ──────────────────────────────────
// `*` and `?` within a path segment, `**` across segments. Dot entries, .git, node_modules and
// symbolic links to directories are not descended into.
function expand(pattern) {
  const segs = pattern.split('/').filter((s) => s !== '' && s !== '.');
  const found = [];
  const re = (seg) => new RegExp(`^${seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')}$`);
  const list = (dir) => { try { return fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; } };
  const walk = (dir, i) => {
    if (i === segs.length) { try { if (fs.statSync(dir).isFile()) found.push(dir); } catch { /* gone */ } return; }
    const s = segs[i];
    if (s === '**') {
      walk(dir, i + 1);
      for (const e of list(dir)) if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') walk(path.join(dir, e.name), i);
      return;
    }
    if (!/[*?]/.test(s)) { walk(path.join(dir, s), i + 1); return; }
    const m = re(s);
    for (const e of list(dir)) if (!e.name.startsWith('.') && m.test(e.name)) walk(path.join(dir, e.name), i + 1);
  };
  walk(path.isAbsolute(pattern) ? '/' : WS, 0);
  return found.sort();
}
function receiptFiles(patterns) {
  const seen = new Set(); const out = [];
  for (const p of patterns) for (const abs of expand(p)) {
    if (seen.has(abs)) continue; seen.add(abs);
    const rel = path.relative(WS, abs);
    const shown = rel.startsWith('..') || path.isAbsolute(rel) ? abs : rel;
    out.push(shown.startsWith('-') ? `./${shown}` : shown);
  }
  if (!out.length) refuse(`no file matches ${patterns.join(', ')} under the workspace`);
  return out;
}

// ── the harness ──────────────────────────────────────────────────────────────
function latestClaudeCode() {
  const r = spawnSync('npm', ['view', '@anthropic-ai/claude-code', 'version'], { encoding: 'utf8', timeout: 60000 });
  if (r.error || r.status !== 0) refuse(`harness-version latest: npm view @anthropic-ai/claude-code version failed (${r.error ? r.error.code || 'did not run' : `exit ${r.status}`})`);
  const v = String(r.stdout || '').trim().split('\n').pop().trim();
  if (!VERSION_RE.test(v)) refuse('harness-version latest: npm printed no version');
  return v;
}
// The harness a receipt names, read as lib/stale.js reads it; null when it cannot be read.
function harnessName(file) {
  try {
    const run = JSON.parse(fs.readFileSync(path.resolve(WS, file), 'utf8')).run || {};
    return (run.harness && typeof run.harness.name === 'string' && run.harness.name) || SURFACE_HARNESS[run.surface] || null;
  } catch { return null; }
}
// Under latest, a receipt of another harness is checked without a version (spec 057 R-4).
const other = (name) => !!name && !['claude-code', 'api'].includes(name);

// ── stale ────────────────────────────────────────────────────────────────────
function runStale(inputs, files, harnessArgs, out) {
  const args = [BIN, 'stale', ...files];
  if (inputs.skill) args.push('--skill', inputs.skill);
  if (inputs.suite) args.push('--suite', inputs.suite);
  if (inputs.model) args.push('--model', inputs.model);
  if (inputs.judge) args.push('--judge', inputs.judge);
  args.push(...harnessArgs);
  if (inputs.strict) args.push('--strict');
  args.push('--json', out);
  const r = spawnSync(process.execPath, args, { cwd: WS, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  quietly(r.stdout);
  let doc = null;
  try { doc = JSON.parse(fs.readFileSync(out, 'utf8')); } catch { /* none written */ }
  if (!doc || doc.schema !== 'driftproof.stale/1') {
    const why = String(r.stderr || '').split('\n').map((l) => l.replace(/^\s*✗\s*/, '').trim()).filter(Boolean)[0] || (r.error ? r.error.message : `exit ${r.status}`);
    refuse(`driftproof stale wrote no report: ${why}`);
  }
  if (doc.exit_code !== r.status) refuse(`driftproof stale exited ${r.status}, but its report says ${doc.exit_code}`);
  return doc;
}

// ── markdown ─────────────────────────────────────────────────────────────────
const code = (s) => `\`${String(s == null ? '' : s).replace(/`/g, "'").replace(/[\r\n]+/g, ' ')}\``;
const cell = (s) => String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').replace(/\|/g, '\\|');
function effectWords(e) {
  if (e.effect === 'unknown') return `unknown: ${e.reason}`;
  if (e.effect === 'advisory') return `advisory: ${e.reason}`;
  if (e.effect === 'regrade') return e.cases && e.cases.length ? `regrade case(s) ${e.cases.join(', ')}` : 'regrade both arms';
  if (e.effect === 'rerun') return e.arms && e.arms.length === 1 ? 'rerun the with-skill arm; the baseline still stands' : 'rerun both arms';
  return e.effect;
}
const moved = (x) => (x.axes || []).filter((e) => e.effect !== 'current');
const advised = (x) => moved(x).some((e) => e.effect === 'advisory') || (x.advisories || []).length > 0;
const newer = (x) => (x.advisories || []).map((a) => `newer model: ${a.model_id}, released ${a.released} (advisory)`);
function notCurrent(x) {
  if (x.error) return cell(x.error);
  const parts = [...moved(x).map((e) => `${e.axis}: ${effectWords(e)}`), ...newer(x)];
  return parts.length ? cell(parts.join('; ')) : '';
}
function summaryOf(ctx, receipts, result) {
  const n = (s) => receipts.filter((x) => (s === 'error' ? x.error : x.status === s)).length;
  const adv = receipts.filter((x) => !x.error && advised(x)).length;
  const L = [
    '## Driftproof staleness check', '',
    `**Result: ${result}.** ${receipts.length} receipt(s): ${n('current')} current, ${n('stale')} stale, ${n('unknown')} unknown, ${n('error')} error(s); ${adv} with an advisory.`,
    `driftproof ${ctx.version}; harness ${ctx.harnessText}${ctx.strict ? '; --strict' : ''}.`, '',
    '| Receipt | Skill | Model | Status | Not current | Next |', '| --- | --- | --- | --- | --- | --- |',
    ...receipts.map((x) => `| ${code(x.path)} | ${x.error ? '' : code(x.skill)} | ${x.error ? '' : code(x.model_id)} | ${x.error ? 'error' : x.status} | ${notCurrent(x)} | ${x.next ? code(x.next) : ''} |`),
    '',
  ];
  return L.join('\n') + '\n';
}
const needsIssue = (ctx, x) => !x.error && (x.status === 'stale' || (ctx.strict && (x.status === 'unknown' || advised(x))));
function issueBody(ctx, marker, listed) {
  const L = [marker, '', `The scheduled Driftproof staleness check found ${listed.length} receipt(s) whose conclusion no longer stands under what would run today.`, ''];
  for (const x of listed) {
    L.push(`### ${code(x.path)}`, '', `${code(x.skill)} on ${code(x.model_id)}, run ${x.date_utc ? String(x.date_utc).slice(0, 10) : 'on an unrecorded date'}: **${x.status}**. With-skill arm: ${x.arms.with_skill.decision}. Baseline arm: ${x.arms.baseline.decision}.`, '');
    L.push('| Axis | Recorded | Now | Effect | Why |', '| --- | --- | --- | --- | --- |');
    for (const e of moved(x)) L.push(`| ${cell(e.axis)} | ${e.recorded == null ? 'unrecorded' : code(e.recorded)} | ${e.current == null ? 'not known' : code(e.current)} | ${cell(effectWords(e))} | ${cell(e.reason)} |`);
    for (const a of newer(x)) L.push(`| newer model | | ${code(a)} | advisory | |`);
    L.push('', x.next ? `Next: ${code(x.next)}` : 'Next: nothing can be decided until the unknown axes are known.', '');
  }
  L.push('---', `Checked by ${ctx.runLink} with driftproof ${ctx.version}. Each run of the check updates this issue, and closes it when every receipt is current again.`, '');
  return L.join('\n');
}

// ── the issue ────────────────────────────────────────────────────────────────
async function api(ctx, method, route, body, what) {
  const base = (env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, '');
  let res;
  try {
    res = await fetch(base + route, {
      method,
      headers: { authorization: `Bearer ${ctx.token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'driftproof-stale-action', ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    // The error's message can quote a header, and the token is a header; it is not printed.
    return refuse(`${what}: the request to the GitHub API failed (${(e.cause && e.cause.code) || e.name})`);
  }
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  return { status: res.status, json, what };
}
const ok = (r) => {
  if (r.status < 200 || r.status >= 300) refuse(`${r.what}: the GitHub API answered ${r.status}${r.json && typeof r.json.message === 'string' ? ` (${r.json.message.slice(0, 120)})` : ''}`);
  return r.json;
};
async function syncIssue(ctx, listed) {
  const repo = env.GITHUB_REPOSITORY; const label = ctx.label;
  const marker = `<!-- driftproof-stale-action: ${label} -->`;
  const list = ok(await api(ctx, 'GET', `/repos/${repo}/issues?state=open&labels=${encodeURIComponent(label)}&per_page=100`, null, 'listing the open issues'));
  if (!Array.isArray(list)) refuse('listing the open issues: the GitHub API answered with something other than a list');
  const mine = list.filter((i) => !i.pull_request && typeof i.body === 'string' && i.body.includes(marker)).sort((a, b) => a.number - b.number);
  const open = mine[0] || null;
  if (listed.length) {
    const payload = { title: `Driftproof: ${listed.length} stale receipt${listed.length === 1 ? '' : 's'}`, body: issueBody(ctx, marker, listed) };
    if (open) { ok(await api(ctx, 'PATCH', `/repos/${repo}/issues/${open.number}`, payload, `updating issue #${open.number}`)); return { number: open.number, did: 'updated' }; }
    const has = await api(ctx, 'GET', `/repos/${repo}/labels/${encodeURIComponent(label)}`, null, 'reading the label');
    if (has.status === 404) {
      const made = await api(ctx, 'POST', `/repos/${repo}/labels`, { name: label, color: 'c5def5', description: 'Opened by the Driftproof staleness check' }, 'creating the label');
      if (made.status !== 422) ok(made);
    } else ok(has);
    const issue = ok(await api(ctx, 'POST', `/repos/${repo}/issues`, { ...payload, labels: [label] }, 'opening the issue'));
    if (!(issue.labels || []).some((l) => (typeof l === 'string' ? l : l && l.name) === label)) refuse(`issue #${issue.number} was opened without the label ${label}, so the next run could not find it; add the label to it`);
    return { number: issue.number, did: 'opened' };
  }
  if (open) {
    const body = [marker, '', `Every receipt is current as of ${ctx.runLink}, checked with driftproof ${ctx.version}.`, ''].join('\n');
    ok(await api(ctx, 'PATCH', `/repos/${repo}/issues/${open.number}`, { state: 'closed', state_reason: 'completed', body }, `closing issue #${open.number}`));
    return { number: open.number, did: 'closed' };
  }
  return { number: null, did: 'none' };
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  const inputs = readInputs();
  const files = receiptFiles(inputs.receipts);
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  const reportDir = fs.mkdtempSync(path.join(env.RUNNER_TEMP || os.tmpdir(), 'driftproof-stale-'));
  setOutputs({ 'report-dir': reportDir });

  // The harness arguments, and under latest the receipts of another harness set apart (R-4).
  const { harness } = inputs;
  const groups = [];
  let harnessText;
  if (harness.mode === 'latest') {
    const mainFiles = files.filter((f) => !other(harnessName(f)));
    const rest = files.filter((f) => other(harnessName(f)));
    const v = mainFiles.length ? latestClaudeCode() : null;
    if (mainFiles.length) groups.push({ files: mainFiles, args: ['--harness-version', v], out: 'stale.json' });
    if (rest.length) groups.push({ files: rest, args: ['--no-harness-check'], out: 'stale-unchecked.json' });
    harnessText = `${v ? `claude-code ${v}, the latest on npm` : 'no Claude Code receipt'}${rest.length ? `; ${rest.length} receipt(s) of another harness not checked` : ''}`;
  } else {
    const base = [];
    if (harness.mode === 'none') base.push('--no-harness-check');
    else base.push('--harness-version', harness.version);
    groups.push({ files, args: base, out: 'stale.json' });
    harnessText = harness.mode === 'none' ? 'not checked (none)' : `${harness.version}, as given`;
  }
  const docs = groups.map((g) => runStale(inputs, g.files, g.args, path.join(reportDir, g.out)));

  const byPath = new Map(docs.flatMap((d) => d.receipts.map((x) => [x.path, x])));
  const receipts = files.map((f) => byPath.get(f)).filter(Boolean);
  const exits = docs.map((d) => d.exit_code);
  const result = RESULT_OF_EXIT[[2, 1, 3, 0].find((c) => exits.includes(c))];
  const runLink = env.GITHUB_RUN_ID && env.GITHUB_REPOSITORY ? `[run ${env.GITHUB_RUN_ID}](${(env.GITHUB_SERVER_URL || 'https://github.com').replace(/\/+$/, '')}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID})` : 'a local run';
  const ctx = { version, harnessText, strict: inputs.strict, label: inputs.label, token: inputs.token, runLink };
  const listed = receipts.filter((x) => needsIssue(ctx, x));
  addSummary(summaryOf(ctx, receipts, result));
  setOutputs({ result, 'stale-count': receipts.filter((x) => !x.error && x.status === 'stale').length });

  if (result === 'error') {
    annotate('error', `driftproof stale could not read ${receipts.filter((x) => x.error).length} receipt(s); the issue is left as it was. See the job summary.`);
    return 1;
  }
  if (inputs.openIssue) {
    const issue = await syncIssue(ctx, listed);
    setOutputs({ 'issue-number': issue.number });
    if (issue.did !== 'none') addSummary(`Issue #${issue.number} ${issue.did}.\n`);
  }
  const failJob = (result === 'stale' && inputs.failOnStale);
  if (result === 'stale') annotate(failJob ? 'error' : 'warning', `${listed.length} receipt(s) no longer current; see the job summary${inputs.openIssue ? ' and the issue' : ''}.`);
  else if (result === 'advisory') annotate('notice', 'Nothing is stale, but an axis is unknown or an advisory fired; see the job summary.');
  return failJob ? 1 : 0;
}

try {
  process.exitCode = await main();
} catch (e) {
  const msg = e instanceof Refusal ? e.message : `unexpected failure: ${e && e.message ? e.message : e}`;
  annotate('error', msg);
  addSummary(`## Driftproof staleness check\n\n**Result: error.** ${cell(msg)}\n`);
  setOutputs({ result: 'error' });
  process.exitCode = 1;
}
