#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Fetch the third-party SKILL.md files for a report into an UNTRACKED workdir.
//
// Driftproof does not commit third-party skill content (see suites/manifest.json).
// This script pulls each skill's SKILL.md from its pinned raw URL, verifies the
// bytes against the manifest's content_sha256 (a hard integrity pin — a changed
// upstream file aborts the run rather than silently drifting the benchmark), and
// lays out a runnable skill directory the runner can load:
//
//   <workdir>/<slug>/SKILL.md            (fetched, untracked)
//   <workdir>/<slug>/evals/evals.json    (copied from our committed suite)
//
// The workdir defaults to <repo>/.skills-workdir and is .gitignore'd, so the
// publish tree never contains third-party skill text.
//
// Usage:
//   node scripts/fetch-skills.js [--manifest suites/manifest.json] [--workdir .skills-workdir] [--only slug1,slug2]

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { flags[argv[i].slice(2)] = argv[i + 1]; i++; }
  }
  return flags;
}

function get(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('too many redirects'));
    https.get(url, { headers: { 'User-Agent': 'driftproof-fetch' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(get(res.headers.location, redirects + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode} for ${url}`)); }
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const manifestPath = path.resolve(flags.manifest || path.join(ROOT, 'suites', 'manifest.json'));
  const workdir = path.resolve(flags.workdir || path.join(ROOT, '.skills-workdir'));
  const only = flags.only ? new Set(flags.only.split(',').map((s) => s.trim())) : null;

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  fs.mkdirSync(workdir, { recursive: true });

  let ok = 0;
  const failures = [];
  for (const skill of manifest.skills) {
    if (only && !only.has(skill.slug)) continue;
    process.stdout.write(`  ${skill.slug} … `);
    let bytes;
    try { bytes = await get(skill.raw_url); }
    catch (e) { failures.push({ slug: skill.slug, error: String(e.message || e) }); console.log(`FETCH FAIL (${e.message})`); continue; }

    const got = sha256(bytes);
    if (got !== skill.content_sha256) {
      failures.push({ slug: skill.slug, error: `sha256 mismatch: manifest ${skill.content_sha256.slice(0, 12)}… got ${got.slice(0, 12)}…` });
      console.log('SHA MISMATCH (upstream changed — pin broken)');
      continue;
    }

    const dir = path.join(workdir, skill.slug);
    fs.mkdirSync(path.join(dir, 'evals'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), bytes);

    // Stage our committed eval suite next to the fetched SKILL.md.
    const suiteSrc = path.join(ROOT, 'suites', skill.slug, 'evals.json');
    if (fs.existsSync(suiteSrc)) {
      fs.copyFileSync(suiteSrc, path.join(dir, 'evals', 'evals.json'));
      console.log(`ok (${bytes.length} bytes, suite staged)`);
    } else {
      console.log(`ok (${bytes.length} bytes, NO suite yet at suites/${skill.slug}/evals.json)`);
    }
    ok += 1;
  }

  console.log(`\nFetched ${ok} skill(s) into ${path.relative(process.cwd(), workdir)}/`);
  if (failures.length) {
    console.error(`\n✗ ${failures.length} failure(s):`);
    for (const f of failures) console.error(`  - ${f.slug}: ${f.error}`);
    process.exit(1);
  }
}

main().catch((e) => { console.error('FATAL', e && (e.stack || e.message || e)); process.exit(2); });
