#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// scripts/indexnow.mjs: tell the search engines that share IndexNow which published pages a publish
// changed (spec 133 AC-12).
//
// THE KEY IS THE FILE. docs/<key>.txt, 32 hex characters whose content is its own name, is published
// at the site's root; an engine fetches it to check that whoever submits owns the host. The key is
// public by design, like the analytics token, and is read here from the file, never typed.
//
// WHAT IS SUBMITTED: the published pages the source range changed (`git diff --diff-filter=AMR` over
// docs/, filtered by build-public.sh's EXCLUDE_RE), less 404.html, redirect stubs and pages that
// carry noindex, each as its canonical URL.
//
// NOTHING IS SENT WITHOUT --send. Submitting is a public step the operator takes at the release,
// after the live check (RUNBOOK § Approve and publish a drafted report, step 9); without the flag the
// script prints the payload and posts nothing. The gate tests it against a stub on 127.0.0.1 only.
//
//   node scripts/indexnow.mjs --since <sha> [--until <sha>] [--endpoint <url>] [--root <dir>] [--send]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ORIGIN = 'https://driftproofhq.com';
const HOST = 'driftproofhq.com';
const ENDPOINT = 'https://api.indexnow.org/indexnow';
// IndexNow takes at most 10,000 URLs in one request.
const BATCH = 10000;

function args(argv) {
  const out = { until: 'HEAD', endpoint: ENDPOINT, root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), send: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--send') out.send = true;
    else if (['--since', '--until', '--endpoint', '--root'].includes(a)) out[a.slice(2)] = argv[++i];
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!out.since) throw new Error('--since <sha> is required: the source commit the last publish was built from');
  return out;
}

function keyOf(root) {
  const docs = path.join(root, 'docs');
  const keys = fs.readdirSync(docs).filter((n) => /^[0-9a-f]{32}\.txt$/.test(n));
  if (keys.length !== 1) throw new Error(`docs/ holds ${keys.length} IndexNow key files; it needs exactly one`);
  const key = keys[0].slice(0, 32);
  if (fs.readFileSync(path.join(docs, keys[0]), 'utf8').trim() !== key) throw new Error(`docs/${keys[0]} does not hold its own name`);
  return key;
}

function excludeRe(root) {
  const src = fs.readFileSync(path.join(root, 'scripts', 'build-public.sh'), 'utf8');
  const m = src.match(/EXCLUDE_RE='([^']+)'/) || src.match(/EXCLUDE_RE="([^"]+)"/);
  if (!m) throw new Error('cannot read EXCLUDE_RE out of scripts/build-public.sh');
  return new RegExp(m[1]);
}

function changedUrls({ root, since, until }) {
  const git = (...a) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const ex = excludeRe(root);
  const files = git('diff', '--name-only', '--diff-filter=AMR', since, until, '--', 'docs/').split('\n').filter((f) => /\.html$/.test(f) && !ex.test(f));
  const out = [];
  for (const f of files) {
    const rel = f.replace(/^docs\//, '');
    if (rel === '404.html') continue;
    const html = git('show', `${until}:${f}`);
    if (/<meta\s+http-equiv="refresh"/i.test(html) || /<meta\s+name="robots"\s+content="[^"]*\bnoindex\b/i.test(html)) continue;
    out.push(`${ORIGIN}/${rel === 'index.html' ? '' : rel.replace(/(^|\/)index\.html$/, '$1')}`);
  }
  return out.sort();
}

async function main() {
  const o = args(process.argv.slice(2));
  const key = keyOf(o.root);
  const urls = changedUrls(o);
  const payloads = [];
  for (let i = 0; i < urls.length; i += BATCH) payloads.push({ host: HOST, key, keyLocation: `${ORIGIN}/${key}.txt`, urlList: urls.slice(i, i + BATCH) });
  if (!urls.length) { process.stdout.write('indexnow: the range changed no published page; nothing to submit\n'); return 0; }
  if (!o.send) {
    process.stdout.write(`indexnow: ${urls.length} URL(s) for ${o.endpoint}; not sent (pass --send)\n${JSON.stringify(payloads, null, 2)}\n`);
    return 0;
  }
  for (const body of payloads) {
    const res = await fetch(o.endpoint, { method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) });
    process.stdout.write(`indexnow: ${body.urlList.length} URL(s) to ${o.endpoint}: HTTP ${res.status}\n`);
    // 200 and 202 are accepted; anything else is the engine refusing, and the operator should see it.
    if (res.status !== 200 && res.status !== 202) return 1;
  }
  return 0;
}

main().then((code) => process.exit(code), (e) => { process.stderr.write(`indexnow: ${e.message}\n`); process.exit(2); });
