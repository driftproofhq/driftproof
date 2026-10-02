#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// The pull request comment (spec 128 AC-12), run by action/comment.sh on a pull request event.
//
// ONE COMMENT PER SKILL DIRECTORY, EDITED IN PLACE. Its first line is a hidden marker carrying a
// short hash of the skill-dir input (lib/plain.js markerLine), so a job that runs the Action for
// two skills keeps two comments, and a later run finds its own and edits it rather than posting
// again. Only a comment a bot wrote is taken as ours: a person who pastes the marker into a comment
// of their own does not have it edited.
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
const { listReceipts, verifyReceiptHash } = require('../lib/receipt');
const { commentMarkdown, markerLine } = require('../lib/plain');

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

async function api(method, url, body) {
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
  if (!res.ok) {
    // The permission is named only where the status can mean it: a 500 is the server's, not the token's.
    const perm = [401, 403, 404].includes(res.status) ? '; the comment needs the pull-requests: write permission, and a pull request from a fork gets a read-only token' : '';
    notice(`the GitHub API answered ${res.status} to ${where}${perm}`);
    throw new NotPosted(String(res.status));
  }
  return res.status === 204 ? null : res.json();
}

// Our comment, if there is one: the marker as its first line, written by a bot.
async function findComment(base, pr, marker) {
  for (let page = 1; page <= 10; page++) {
    const list = await api('GET', `${base}/issues/${pr}/comments?per_page=100&page=${page}`);
    if (!Array.isArray(list)) return null;
    const hit = list.find((c) => c && typeof c.body === 'string' && c.body.startsWith(`${marker}\n`) && c.user && c.user.type === 'Bot');
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
  const d = decision.decideSet(dir, env.INPUT_MODELS || '', {
    failOnRegression: env.INPUT_FAIL_ON_REGRESSION !== 'false',
    failOnUnderpowered: env.INPUT_FAIL_ON_UNDERPOWERED === 'true',
  });
  const key = crypto.createHash('sha256').update(String(env.INPUT_SKILL_DIR || '')).digest('hex').slice(0, 16);
  const runUrl = env.GITHUB_SERVER_URL && env.GITHUB_RUN_ID ? `${env.GITHUB_SERVER_URL}/${repo}/actions/runs/${env.GITHUB_RUN_ID}` : null;
  const body = commentMarkdown(d, dir, { key, runUrl });
  const base = `${(env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, '')}/repos/${repo}`;
  const existing = await findComment(base, pr, markerLine(key));
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
  .finally(() => process.exit(0));
