#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// AC-10 (spec 002) — are the skills we measured still the skills upstream ships?
//
// Report #005 pins each skill at a commit (suites/manifest.json). A reader is
// entitled to know whether the pinned text is still current, and whether any
// upstream revision was a response to a Driftproof finding. The first half is
// mechanical and is what this script measures: fetch each skill's SKILL.md at the
// upstream default branch, hash it, compare against the pinned content_sha256.
//
// It lives outside the report renderer on purpose. The renderer stays free of
// network access (spec 002 NFR-1) and reads the record this writes; the spec gate
// independently re-fetches and requires the rendered count to equal what upstream
// says at gate time, so a stale record fails the gate instead of publishing a
// number that has rotted.
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const MANIFEST = path.join(ROOT, 'suites', 'manifest.json');
const OUT = path.join(ROOT, 'state', 'skill-version-check.json');

function get(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'driftproof-skill-drift' } }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && redirects < 4) {
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

async function checkSkillDrift({ nowIso } = {}) {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const skills = [];
  for (const s of manifest.skills) {
    const liveUrl = s.raw_url.replace(s.repo_sha, 'HEAD');
    // A fetch failure is recorded, never smoothed over: an unknown is not a match.
    let identical = null, liveSha = null, error = null;
    try {
      const bytes = await get(liveUrl);
      liveSha = crypto.createHash('sha256').update(bytes).digest('hex');
      identical = liveSha === s.content_sha256;
    } catch (e) { error = e.message; }
    skills.push({ slug: s.slug, repo: s.repo, pinned_sha256: s.content_sha256, live_sha256: liveSha, identical, error });
  }
  const checked = skills.filter((x) => x.identical !== null);
  const record = {
    checked_at: nowIso || new Date().toISOString(),
    source: 'upstream default branch (HEAD) via raw.githubusercontent.com',
    total: skills.length,
    identical: checked.filter((x) => x.identical).length,
    revised: checked.filter((x) => !x.identical).map((x) => x.slug),
    unverified: skills.filter((x) => x.identical === null).map((x) => x.slug),
    skills,
  };
  return record;
}

if (require.main === module) {
  checkSkillDrift().then((r) => {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(r, null, 2));
    console.log(`${r.identical} of ${r.total} pinned skills are byte-identical to upstream`);
    if (r.revised.length) console.log(`  revised upstream: ${r.revised.join(', ')}`);
    if (r.unverified.length) { console.error(`  UNVERIFIED: ${r.unverified.join(', ')}`); process.exit(1); }
    console.log(`  written to ${path.relative(ROOT, OUT)}`);
  }).catch((e) => { console.error(e.message); process.exit(1); });
}

module.exports = { checkSkillDrift };
