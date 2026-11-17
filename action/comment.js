#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// The pull request comment (spec 128 AC-12), run by action/comment.sh on a pull request event.
//
// Explicit comments use the skill directory marker; automatic comments use
// workflow, job, matrix and invocation identity. Only the authenticated
// token's own bot login can authorize an edit.
// A matching marker alone is not ownership.
//
// IT NEVER FAILS A RUN. Every way it cannot post writes one ::notice, the first reason found, and
// the process exits 0 whatever happened. The words are lib/plain.js's, over the decision
// lib/decision.js decideSet takes with the inputs the enforcement step passes, after every receipt
// in the directory has verified, as `decide` requires before it reads one.
//
// The token is the job's own (github.token, mapped by action.yml). No third-party action and no
// dependency: node's fetch, with a timeout on every request.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const decision = require('../lib/decision');
const { listReceipts, verifyReceiptHash, validateReceipt } = require('../lib/receipt');
const { markerLine } = require('../lib/plain');
const { commentMarkdown } = require('../lib/action-words');

const env = process.env;
const TIMEOUT_MS = Number(env.DRIFTPROOF_COMMENT_TIMEOUT_MS) > 0 ? Number(env.DRIFTPROOF_COMMENT_TIMEOUT_MS) : 15000;

// One ::notice per run: the first reason is the one written, and a later call is dropped.
let told = false;
function notice(msg) {
  if (told) return;
  told = true;
  const data = `The pull request comment was not posted: ${msg}. The run's result is unchanged.`
    .replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  process.stdout.write(`::notice title=Driftproof::${data}\n`);
}

class NotPosted extends Error {}
const INSTALLATION_TOKEN = Symbol('installation token');

async function api(method, url, body, installationUserLookup = false) {
  const where = `${method} ${new URL(url).pathname}`;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${env.GITHUB_TOKEN}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'driftproof-action',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    const why = e && e.name === 'TimeoutError' ? `no answer within ${TIMEOUT_MS} ms` : (e && e.cause && e.cause.code) || (e && e.message) || 'an unknown error';
    notice(`the GitHub API could not be reached on ${where} (${why})`);
    throw new NotPosted(why);
  }
  // A status alone cannot prove this is an installation token: rate limits
  // and other transient refusals can also return 403 for personal tokens.
  if (installationUserLookup && res.status === 403) {
    let refusal;
    try { refusal = await res.json(); } catch { return null; }
    return refusal?.message === 'Resource not accessible by integration' ? INSTALLATION_TOKEN : null;
  }
  if (!res.ok) {
    // The permission is named only where the status can mean it: a 500 is the server's, not the token's.
    const perm = [401, 403, 404].includes(res.status) ? '; the comment needs the pull-requests: write permission, and a pull request from a fork gets a read-only token' : '';
    notice(`the GitHub API answered ${res.status} to ${where}${perm}`);
    throw new NotPosted(String(res.status));
  }
  return res.status === 204 ? null : res.json();
}

// GraphQL viewer resolves installation tokens as well as user tokens. The
// workflow actor is not necessarily the account whose token posts the comment.
async function tokenIdentity(apiRoot) {
  const graphql=env.GITHUB_GRAPHQL_URL || apiRoot.replace(/\/api\/v3$/, '/api')+'/graphql';
  const response=await api('POST',graphql,{query:'query { viewer { login } }'});
  const login=response?.data?.viewer?.login;
  if (response?.errors?.length || typeof login!=='string' || !/^[a-zA-Z0-9-]+(?:\[bot\])?$/.test(login)) {
    notice("the token's own login could not be verified");
    throw new NotPosted('token identity unavailable');
  }
  if (login.endsWith('[bot]')) return {login,type:'Bot'};
  const user = await api('GET', `${apiRoot}/user`, undefined, true);
  // Without positive bot evidence, post anew. Never edit a User comment.
  return {login,type:user === INSTALLATION_TOKEN ? 'Bot' : null};
}

// Bot logins may omit [bot] in GraphQL. Both token identity and REST author
// must be Bot before a marker-bearing comment can be edited.
async function findComment(base, pr, marker, {login,type}) {
  if (type !== 'Bot') return null;
  for (let page = 1; page <= 10; page++) {
    const list = await api('GET', `${base}/issues/${pr}/comments?per_page=100&page=${page}`);
    if (!Array.isArray(list)) return null;
    const marked = list.filter((c) => c && typeof c.body === 'string' && c.body.startsWith(`${marker}\n`) && c.user);
    const hit = marked.find(c => c.user.type === 'Bot' && (c.user.login === login || c.user.login === login+'[bot]'));
    if (hit) return hit;
    if (list.length < 100) return null;
  }
  return null;
}

function prNumber(eventPath) {
  try {
    const ev = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
    const n = ev && ev.pull_request && ev.pull_request.number;
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch { return null; }
}

function comparisonMarkdown(dir) {
  const file = path.join(dir, 'compare.md');
  if (!fs.existsSync(file)) return '';
  const a = listReceipts(path.join(dir, 'base'));
  const b = listReceipts(dir);
  if (!a.length || a.length !== b.length) throw new Error('comparison receipt pairs are missing');
  for (const entry of [...a, ...b]) {
    if (!entry.receipt || !verifyReceiptHash(entry.receipt) || !validateReceipt(entry.receipt).valid) {
      throw new Error('a comparison receipt does not verify');
    }
  }
  for (const entry of a) {
    const matches = b.filter((other) => other.receipt.run.model_id === entry.receipt.run.model_id);
    if (matches.length !== 1) throw new Error('comparison model pairs are ambiguous');
  }
  // compare.md is written by the comparison library, including its shared
  // Markdown escaping. Preserve every task line, length and closing caveat.
  const report = fs.readFileSync(file, 'utf8');
  const hashes = 'Base (A): ' + a[0].receipt.skill.content_hash.slice(0, 8) +
    '. New (B): ' + b[0].receipt.skill.content_hash.slice(0, 8) + '.';
  return report + '\n' + hashes + '\n\n';
}

async function main() {
  const dir = env.DRIFTPROOF_RECEIPTS;
  if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return notice('the run wrote no receipts directory');
  const unsealed = listReceipts(dir).find((l) => l.receipt && !verifyReceiptHash(l.receipt));
  if (unsealed) return notice(`the receipt_hash of ${path.basename(unsealed.file)} does not verify`);
  if (!env.GITHUB_TOKEN) return notice('no token reached the step');
  const pr = prNumber(env.GITHUB_EVENT_PATH);
  if (!pr) return notice('the event names no pull request number');
  const repo = env.GITHUB_REPOSITORY;
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) return notice('GITHUB_REPOSITORY names no repository');
  const wholePR = env.INPUT_SKILL_DIR === '';
  const table = wholePR || env.INPUT_FAIL_ON_FAKE === 'true';
  const check = require('./pr-check');
  const d = table ? null : decision.decideSet(dir, env.INPUT_MODELS || '', {
    failOnRegression: env.INPUT_FAIL_ON_REGRESSION !== 'false',
    failOnUnderpowered: env.INPUT_FAIL_ON_UNDERPOWERED === 'true',
  });
  const key = crypto.createHash('sha256').update(String(env.INPUT_SKILL_DIR || '')).digest('hex').slice(0, 16);
  const runUrl = env.GITHUB_SERVER_URL && env.GITHUB_RUN_ID ? `${env.GITHUB_SERVER_URL}/${repo}/actions/runs/${env.GITHUB_RUN_ID}` : null;
  const marker = wholePR ? check.automaticMarker(env) : markerLine(key);
  const plain = wholePR ? marker + '\n' + check.render(JSON.parse(fs.readFileSync(path.join(dir, 'check.json'), 'utf8')), dir, check.options(env), runUrl)
    : table ? markerLine(key) + '\n' + check.singleMarkdown(env) : commentMarkdown(d, dir, { key, runUrl });
  const comparison = wholePR ? '' : comparisonMarkdown(dir);
  const body = comparison ? marker + "\n" + comparison + plain.slice(marker.length + 1) : plain;
  const apiRoot = (env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, '');
  const base = `${apiRoot}/repos/${repo}`;
  const identity = await tokenIdentity(apiRoot);
  const existing = await findComment(base, pr, marker, identity);
  if (existing) {
    await api('PATCH', `${base}/issues/comments/${existing.id}`, { body });
    console.log(`Driftproof: edited the pull request comment ${existing.id}.`);
  } else {
    const made = await api('POST', `${base}/issues/${pr}/comments`, { body });
    console.log(`Driftproof: posted the pull request comment ${made && made.id}.`);
  }
}

main()
  .catch((e) => notice(e && e.message ? `an unexpected error: ${e.message}` : 'an unexpected error'))
  .finally(() => { process.exitCode = 0; });
