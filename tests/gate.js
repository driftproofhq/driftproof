#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// driftproof gate (Week 2). Dogfoods lib/runner's Gate engine.
//
// Preserves every Week-1 check and adds:
//   - rename completeness (zero pre-rename-name hits) — BLOCKING
//   - sampled receipts validate against schema v0.2; v0.1 receipts still load
//   - borderline outcome when the threshold sits inside mean ± stddev
//   - drift "within noise" on overlapping bands, "regression" ONLY on non-overlap
//   - hardened example: recorded with_skill mean in [0.65, 0.95], baseline >=0.15 lower
//   - confidentiality (deny-list) + hygiene (paths/emails/tokens/env/host-ip) scans
//   - live sampled runner on haiku (DRIFTPROOF_LIVE=1)
//
// Scans run on DRIFTPROOF_SCAN_ROOT if set (the exact tree being published),
// else the repo root.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { Gate } = require('../lib/runner');
const { buildReceipt, validateReceipt, verifyReceiptHash, computeReceiptHash } = require('../lib/receipt');
const { buildDriftReport } = require('../lib/diff');
const { outcomeFor } = require('../lib/run');
const { mean, stddev } = require('../lib/stats');
const { sha256 } = require('../lib/canonical');
const modelsLib = require('../lib/models');
const { estimateRunCostUSD, BudgetTracker, perCallCostUSD } = require('../lib/cost');
const { verdictFromReceipt, badgeEndpoint, githubOutputLines } = require('../lib/verdict');
const { scaffoldInit } = require('../lib/init');
const { normalizeCases } = require('../lib/skill');

const ROOT = path.join(__dirname, '..');
const SCAN_ROOT = process.env.DRIFTPROOF_SCAN_ROOT ? path.resolve(process.env.DRIFTPROOF_SCAN_ROOT) : ROOT;
const EXAMPLE = path.join(ROOT, 'examples', 'commit-message-conventions');
const gate = new Gate('driftproof phase-5 gate');

const JUDGE = { model_id: 'claude-haiku-4-5-20251001', rubric_hash: 'a'.repeat(64) };
const RUN_META = { model_id: 'claude-haiku-4-5-20251001', model_release_date: '2025-10-01', surface: 'claude-cli', runner_version: '0.3.0', date_utc: '2026-07-27T00:00:00.000Z', registry: 'registered', transcripts: 'hashes-only', judge: { samples: 5, temperature: null, sampling: 'surface-controlled', surface: 'claude-cli' } };

function mkcase(id, modeName, samples, threshold) {
  const m = mean(samples), sd = stddev(samples);
  // v0.3: synthetic per-sample hashes (deterministic) so the built receipt
  // validates against the v0.3 schema, which requires generation_hash +
  // judge_sample_hashes[] on every case.
  return {
    id, mode: modeName, outcome: outcomeFor(m, sd, threshold), score: m, mean: m, stddev: sd, samples,
    generation_hash: sha256(`${id}|${modeName}|gen`),
    judge_sample_hashes: samples.map((_s, i) => sha256(`${id}|${modeName}|j${i}`)),
    threshold, reason: 'synthetic', judge: JUDGE,
  };
}
function synthReceipt(cases, date = RUN_META.date_utc) {
  return buildReceipt({
    skill: { name: 'demo', version: '0.1.0', contentHash: 'b'.repeat(64) },
    suite: { format: 'agentskills.io/evals', suiteHash: 'c'.repeat(64), caseCount: 2 },
    run: { ...RUN_META, date_utc: date },
    cases,
  });
}

// ── 1. Rename completeness (BLOCKING) ────────────────────────────────────────
gate.section('rename');
{
  // The pre-rename name is base64'd so this scanner file does not itself contain
  // the literal string it forbids (which would self-trigger the check).
  const OLD_NAME = Buffer.from('c2tpbGxwcm9vZg==', 'base64').toString('utf8');
  const oldRe = new RegExp(OLD_NAME, 'i');
  const files = listFiles(SCAN_ROOT);
  const hits = [];
  for (const rel of files) {
    let c; try { c = fs.readFileSync(path.join(SCAN_ROOT, rel), 'utf8'); } catch (_e) { continue; }
    if (oldRe.test(c) || oldRe.test(rel)) hits.push(rel);
  }
  gate.check('zero references to the pre-rename project name (case-insensitive)', hits.length === 0, { hits: hits.slice(0, 20) });
}

// ── 2. Schema v0.3 + round-trip + tamper ─────────────────────────────────────
gate.section('schema v0.3 + round-trip');
{
  const r = synthReceipt([
    mkcase('c1', 'with_skill', [0.9, 0.88, 0.92, 0.9, 0.9], 0.7),
    mkcase('c1', 'baseline', [0.4, 0.45, 0.4, 0.42, 0.4], 0.7),
  ]);
  const v = validateReceipt(r);
  gate.check('sampled receipt validates against schema v0.3', v.valid && v.version === '0.3', v.errors);
  gate.check('receipt stamps schema_version 0.3 + run.registry + run.transcripts',
    r.schema_version === '0.3' && !!r.run.registry && !!r.run.transcripts, { sv: r.schema_version, reg: r.run.registry, tr: r.run.transcripts });
  gate.check('receipt_hash self-verifies', verifyReceiptHash(r));
  const round = JSON.parse(JSON.stringify(r));
  gate.check('hash stable across JSON round-trip', verifyReceiptHash(round) && round.receipt_hash === r.receipt_hash);
  gate.check('computeReceiptHash idempotent', computeReceiptHash(r) === r.receipt_hash);
  const tampered = JSON.parse(JSON.stringify(r));
  tampered.results.cases[0].samples[0] = 0.01;
  gate.check('tampering a sample breaks receipt_hash', !verifyReceiptHash(tampered));
  const tampered2 = JSON.parse(JSON.stringify(r));
  tampered2.results.cases[0].generation_hash = 'f'.repeat(64);
  gate.check('tampering a generation_hash breaks receipt_hash', !verifyReceiptHash(tampered2));
  const bad = JSON.parse(JSON.stringify(r));
  bad.verification_level = 'FORMAL';
  gate.check('reserved FORMAL level rejected by schema', !validateReceipt(bad).valid);
  // A v0.3 receipt missing the new required per-case hashes must be rejected.
  const missingHash = JSON.parse(JSON.stringify(r));
  delete missingHash.results.cases[0].judge_sample_hashes;
  gate.check('v0.3 rejects a case with no judge_sample_hashes', !validateReceipt(missingHash).valid);
}

// ── 3. Backward-compat: v0.1 AND v0.2 receipts still load ─────────────────────
gate.section('backward-compat');
{
  const p = path.join(ROOT, 'tests', 'fixtures', 'receipt-v0.1.json');
  const r = JSON.parse(fs.readFileSync(p, 'utf8'));
  const v = validateReceipt(r);
  gate.check('v0.1 receipt validates against the v0.1 schema', v.valid && v.version === '0.1', v.errors);
  gate.check('v0.1 receipt self-hash still verifies', verifyReceiptHash(r));

  const p2 = path.join(ROOT, 'tests', 'fixtures', 'receipt-v0.2.json');
  const r2 = JSON.parse(fs.readFileSync(p2, 'utf8'));
  const v2 = validateReceipt(r2);
  gate.check('v0.2 receipt validates against the v0.2 schema', v2.valid && v2.version === '0.2', v2.errors);
  gate.check('v0.2 receipt self-hash still verifies', verifyReceiptHash(r2));
}

// ── 4. Borderline outcome ────────────────────────────────────────────────────
gate.section('borderline outcome');
{
  // threshold 0.7 sits inside 0.70 ± ~0.015 → borderline
  const border = mkcase('b', 'with_skill', [0.70, 0.69, 0.72, 0.68, 0.71], 0.7);
  gate.check('threshold inside band → outcome "borderline"', border.outcome === 'borderline', border);
  const clearPass = mkcase('p', 'with_skill', [0.9, 0.91, 0.89, 0.9, 0.9], 0.7);
  gate.check('band clear above threshold → "pass"', clearPass.outcome === 'pass', clearPass);
  const clearFail = mkcase('f', 'with_skill', [0.3, 0.31, 0.29, 0.3, 0.3], 0.7);
  gate.check('band clear below threshold → "fail"', clearFail.outcome === 'fail', clearFail);
  const r = synthReceipt([border, mkcase('b', 'baseline', [0.2, 0.21, 0.2, 0.2, 0.19], 0.7)]);
  gate.check('borderline receipt validates and surfaces in aggregates', validateReceipt(r).valid && r.results.aggregates.with_skill.borderline_count === 1, r.results.aggregates.with_skill);
}

// ── 5. Drift band logic: within-noise vs regression ──────────────────────────
gate.section('drift bands');
{
  const A = synthReceipt([
    mkcase('reg', 'with_skill', [0.90, 0.90, 0.90, 0.90, 0.90], 0.7),
    mkcase('reg', 'baseline', [0.4, 0.4, 0.4, 0.4, 0.4], 0.7),
    mkcase('noise', 'with_skill', [0.80, 0.75, 0.85, 0.78, 0.82], 0.7),
    mkcase('noise', 'baseline', [0.3, 0.3, 0.3, 0.3, 0.3], 0.7),
  ]);
  // B: 'reg' drops clear of A's band (regression); 'noise' shifts within its band
  const B = synthReceipt([
    mkcase('reg', 'with_skill', [0.50, 0.50, 0.50, 0.50, 0.50], 0.7),
    mkcase('reg', 'baseline', [0.4, 0.4, 0.4, 0.4, 0.4], 0.7),
    mkcase('noise', 'with_skill', [0.79, 0.82, 0.76, 0.80, 0.83], 0.7),
    mkcase('noise', 'baseline', [0.3, 0.3, 0.3, 0.3, 0.3], 0.7),
  ], '2026-08-15T00:00:00.000Z');
  const d = buildDriftReport(A, B, { labelA: 'A', labelB: 'B' });
  const byId = Object.fromEntries(d.perCase.map((r) => [r.id, r.verdict]));
  gate.check('non-overlapping band drop → "regression"', byId.reg === 'regression', byId);
  gate.check('overlapping bands → "within noise" (no false regression)', byId.noise === 'within noise', byId);
  gate.check('exactly one regression claimed', d.regressions.length === 1, { regressions: d.regressions.map((r) => r.id) });
  gate.check('drift markdown has headline + per-case table', /## Headline/.test(d.markdown) && /Per-case with_skill/.test(d.markdown));
}

// ── 6. Hardened example recorded run ─────────────────────────────────────────
gate.section('hardened example');
{
  const recDir = path.join(ROOT, 'reports', 'example-receipts');
  const rec = fs.existsSync(recDir) ? fs.readdirSync(recDir).filter((f) => f.endsWith('.json')).sort() : [];
  if (!rec.length) {
    gate.check('recorded hardened-suite receipt present (run the suite to populate reports/example-receipts/)', false, { hint: 'node bin/driftproof run examples/commit-message-conventions --out reports/example-receipts' });
  } else {
    // Validate every recorded receipt; assert the primary (run-a) is in-window.
    const allOk = rec.every((f) => { const rr = JSON.parse(fs.readFileSync(path.join(recDir, f), 'utf8')); return validateReceipt(rr).valid && verifyReceiptHash(rr); });
    gate.check('all recorded receipts validate + self-verify', allOk, { rec });
    const primary = rec.includes('run-a.json') ? 'run-a.json' : rec[0];
    const r = JSON.parse(fs.readFileSync(path.join(recDir, primary), 'utf8'));
    const w = r.results.aggregates.with_skill.mean_score;
    const b = r.results.aggregates.baseline.mean_score;
    gate.check('recorded with_skill mean in [0.65, 0.95]', w >= 0.65 && w <= 0.95, { with_skill: w });
    gate.check('recorded baseline is >= 0.15 below with_skill', (w - b) >= 0.15, { with_skill: w, baseline: b, gap: +(w - b).toFixed(3) });
    gate.check('hardened suite has 8–12 cases', r.suite.case_count >= 8 && r.suite.case_count <= 12, { case_count: r.suite.case_count });
    gate.check('recorded receipt validates + self-verifies', validateReceipt(r).valid && verifyReceiptHash(r));
  }
}

// ── 7. Confidentiality scan (BLOCKING) ───────────────────────────────────────
gate.section('confidentiality');
{
  const dec = (b64) => JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  const SUBSTR = dec('WyJTZWF0cml1bSIsIk11c2ltIE1hcyIsIlBhbmFzb25pYyIsIkJvbHR0ZWNoIiwiQ2hhcmxlcyBhbmQgS2VpdGgiLCJTdW5saWZlIiwiSnVyb25nIFBvcnQiLCJUZWxlLWNlbnRyZSIsIldyaXNlIiwiQXlhbGEiLCJTaW5hciBNYXMiLCJTb2Z0d2FyZU9uZSIsInNvZnR3YXJlb25lIl0=');
  const WORD = dec('WyJSR0UiLCJPRkkiLCJSSEIiLCJTQkYiLCJNQlMiLCJTSUEiLCJUUEwiLCJQRUFNIiwiQURCIiwiU1cxIl0=');
  const FILENAME_PATTERNS = [/rate-card.*\.json$/i, /funding-rules.*\.json$/i, /workstreams.*\.json$/i, /^spi.*\.json$/i];
  const files = listFiles(SCAN_ROOT);
  const hits = [];
  for (const rel of files) {
    for (const pat of FILENAME_PATTERNS) if (pat.test(path.basename(rel))) hits.push({ file: rel, term: `filename:${pat}` });
    let c; try { c = fs.readFileSync(path.join(SCAN_ROOT, rel), 'utf8'); } catch (_e) { continue; }
    for (const t of SUBSTR) if (c.toLowerCase().includes(t.toLowerCase())) hits.push({ file: rel, term: t });
    for (const t of WORD) if (new RegExp(`\\b${t}\\b`).test(c)) hits.push({ file: rel, term: t });
  }
  gate.check('repo-wide deny-list scan returns zero hits', hits.length === 0, { hits: hits.slice(0, 20) });
  gate.check('scan covered a non-trivial file set', files.length >= 10, { fileCount: files.length });
}

// ── 8. Hygiene scan (BLOCKING) ───────────────────────────────────────────────
gate.section('hygiene');
{
  const dec = (b64) => JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  // Build-box host + private IP, base64 so the plaintext never lands in a file.
  const HOSTIP = dec('WyJpcC0xNzItMzEtNDAtMTU5LmFwLXNvdXRoZWFzdC0xLmNvbXB1dGUuaW50ZXJuYWwiLCIxNzIuMzEuNDAuMTU5Il0=');
  const EMAIL_ALLOW = new Set(['example.com', 'example.org', 'driftproofhq.com']);
  const files = listFiles(SCAN_ROOT);
  const hits = [];
  const patterns = [
    { name: 'home-path', re: /\/home\/[a-z0-9_-]+\/|\/Users\/[A-Za-z0-9_-]+\// },
    { name: 'ec2-internal-host', re: /ip-\d+-\d+-\d+-\d+\.[a-z0-9.-]*compute\.(internal|amazonaws\.com)/i },
    { name: 'private-ip', re: /\b(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b/ },
    { name: 'anthropic-key', re: /sk-ant-[A-Za-z0-9_-]{8,}/ },
    { name: 'github-token', re: /gh[pousr]_[A-Za-z0-9]{20,}/ },
    { name: 'aws-key', re: /\bAKIA[0-9A-Z]{16}\b/ },
    { name: 'private-key-block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
    { name: 'env-secret-assignment', re: /\b(ANTHROPIC_API_KEY|AWS_SECRET_ACCESS_KEY|OPENAI_API_KEY)\s*=\s*\S+/ },
  ];
  for (const rel of files) {
    if (/(^|\/)\.env(\.|$)/.test(rel)) hits.push({ file: rel, kind: 'env-file' });
    let c; try { c = fs.readFileSync(path.join(SCAN_ROOT, rel), 'utf8'); } catch (_e) { continue; }
    for (const p of patterns) { const m = c.match(p.re); if (m) hits.push({ file: rel, kind: p.name, sample: m[0].slice(0, 24) }); }
    for (const hv of HOSTIP) if (c.includes(hv)) hits.push({ file: rel, kind: 'build-host-or-ip' });
    const emails = c.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g) || [];
    for (const e of emails) { const dom = e.split('@')[1].toLowerCase(); if (!EMAIL_ALLOW.has(dom) && !dom.endsWith('.example')) hits.push({ file: rel, kind: 'email', sample: e }); }
  }
  gate.check('hygiene scan (paths/emails/tokens/env/host-ip) returns zero hits', hits.length === 0, { hits: hits.slice(0, 20) });
}

// ── 8b. Credential-format policy (BLOCKING) ──────────────────────────────────
// No string anywhere in the publish tree may match a known live-credential
// format — not even a fake one. The hygiene scan above catches real leaks; this
// rule additionally bans credential-SHAPED fixtures (e.g. a synthetic API key
// planted in an eval prompt), because push-protection scanners (GitHub, GitLab,
// etc.) reject those on sight regardless of whether they are real, and a blocked
// push is a publish outage. Fixtures that need to depict a hardcoded secret MUST
// use an invented provider prefix that matches no scanner signature
// (e.g. `acme_live_…`). See CONTRIBUTING.md § "Scanner-safe fixtures".
//
// The prefixes below are written so the regex literal cannot match its own text
// (a metacharacter follows each fixed prefix), the same way the hygiene patterns
// above already scan this file without self-tripping.
gate.section('credential-format policy');
{
  const CRED_FORMATS = [
    { name: 'stripe',        re: /\b(sk|pk|rk)_(live|test)_[0-9A-Za-z]{16,}\b/ },
    { name: 'github-token',  re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
    { name: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/ },
    { name: 'slack-token',   re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/ },
    { name: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
    { name: 'openai-anthropic', re: /\bsk-(ant-)?[A-Za-z0-9]{24,}\b/ },
    { name: 'gcp-oauth',     re: /\b[0-9]+-[0-9A-Za-z_]{32}\.apps\.googleusercontent\.com\b/ },
    { name: 'slack-webhook', re: /hooks\.slack\.com\/services\/[A-Za-z0-9/]{20,}/ },
  ];
  const files = listFiles(SCAN_ROOT);
  const hits = [];
  for (const rel of files) {
    let c; try { c = fs.readFileSync(path.join(SCAN_ROOT, rel), 'utf8'); } catch (_e) { continue; }
    for (const p of CRED_FORMATS) { const m = c.match(p.re); if (m) hits.push({ file: rel, kind: p.name, sample: m[0].slice(0, 10) + '…' }); }
  }
  gate.check('no live-credential-format strings anywhere in the tree (fixtures must be scanner-safe)', hits.length === 0, { hits: hits.slice(0, 20) });
}

// ── 8c. Publish-tree draft guard (BLOCKING) ──────────────────────────────────
// A sitting unreviewed draft must NEVER ride along with an unrelated publish.
// build-public.sh excludes every *-draft/ dir + reports/pending-publish.md, and
// draft dirs are gitignored — so this asserts the (published) tree carries no
// such path. It passes on the dev tree too (nothing tracked or untracked-non-
// ignored matches), and is the real backstop when scanning the published tree.
gate.section('publish-tree draft guard');
{
  const files = listFiles(SCAN_ROOT);
  const draftHits = files.filter((f) => /(^|\/)[^/]*-draft\//.test(f));
  gate.check('no *-draft/ path exists in the (published) tree', draftHits.length === 0, { draftHits: draftHits.slice(0, 20) });
  // The pending-publish queue must not ride a publish. It IS tracked on the dev
  // tree (an empty placeholder), so only assert its absence against a published
  // SCAN_ROOT (where build-public.sh has excluded it).
  if (process.env.DRIFTPROOF_SCAN_ROOT) {
    const pendingHits = files.filter((f) => f === 'reports/pending-publish.md');
    gate.check('published tree excludes reports/pending-publish.md', pendingHits.length === 0, { pendingHits });
  } else {
    gate.check('pending-publish.md exclusion (asserted only against a published SCAN_ROOT)', true, { skipped: true });
  }
}

// ── 9. Live sampled runner (opt-in) ──────────────────────────────────────────
gate.section('live runner (haiku, sampled)');
if (process.env.DRIFTPROOF_LIVE === '1') {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'driftproof-gate-'));
  try {
    execFileSync('node', [
      path.join(ROOT, 'bin', 'driftproof'), 'run', EXAMPLE,
      '--models', 'haiku', '--max-cases', String(process.env.DRIFTPROOF_MAX_CASES || 1),
      '--samples', String(process.env.DRIFTPROOF_SAMPLES || 3), '--max-calls', '60', '--out', outDir,
    ], { cwd: ROOT, stdio: 'inherit', timeout: 12 * 60 * 1000 });
    const emitted = fs.readdirSync(outDir).filter((f) => f.endsWith('.json'));
    gate.check('live run emitted at least one receipt', emitted.length >= 1, { emitted });
    let allValid = emitted.length > 0, bothModes = true, hasBands = true;
    for (const f of emitted) {
      const r = JSON.parse(fs.readFileSync(path.join(outDir, f), 'utf8'));
      if (!validateReceipt(r).valid || !verifyReceiptHash(r)) allValid = false;
      const modes = new Set(r.results.cases.map((c) => c.mode));
      if (!(modes.has('with_skill') && modes.has('baseline'))) bothModes = false;
      if (!r.results.cases.every((c) => Array.isArray(c.samples) && c.samples.length >= 1)) hasBands = false;
    }
    gate.check('every live receipt validates + self-verifies', allValid);
    gate.check('live receipts contain BOTH with_skill and baseline', bothModes);
    gate.check('live receipts carry per-case judge samples', hasBands);
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
} else {
  gate.check('live sampled runner e2e (set DRIFTPROOF_LIVE=1 to execute)', true, { skipped: true });
}

// ── 10. Report #001 manifest + no third-party skill content (BLOCKING) ───────
gate.section('report-001 manifest');
{
  const PERMISSIVE = new Set(['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'CC-BY', 'CC-BY-4.0', 'CC-BY-3.0', 'ISC']);
  const manifestPath = path.join(ROOT, 'suites', 'manifest.json');
  const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : null;
  gate.check('suites/manifest.json present', !!manifest);
  if (manifest) {
    const bad = [];
    for (const s of manifest.skills) {
      if (!s.slug) bad.push('missing slug');
      if (!/^https?:\/\/\S+/.test(s.repo || '')) bad.push(`${s.slug}: repo url`);
      if (!/^https:\/\/raw\.githubusercontent\.com\/\S+/.test(s.raw_url || '')) bad.push(`${s.slug}: raw_url`);
      if (!/^[0-9a-f]{40}$/.test(s.repo_sha || '')) bad.push(`${s.slug}: repo_sha`);
      if (!/^[0-9a-f]{64}$/.test(s.content_sha256 || '')) bad.push(`${s.slug}: content_sha256`);
      if (!s.author) bad.push(`${s.slug}: author`);
      if (!PERMISSIVE.has(s.license)) bad.push(`${s.slug}: non-permissive license "${s.license}"`);
      // Every tested skill must have a committed suite.
      if (!fs.existsSync(path.join(ROOT, 'suites', s.slug, 'evals.json'))) bad.push(`${s.slug}: no committed suite`);
    }
    gate.check('every manifest skill has source URL + 40-hex SHA + content sha256 + author', bad.filter((b) => !/license/.test(b)).length === 0, { bad });
    gate.check('every tested skill license is permissive (MIT/Apache-2.0/CC-BY/BSD/ISC)', bad.filter((b) => /license/.test(b)).length === 0, { bad: bad.filter((b) => /license/.test(b)) });
    gate.check('manifest tests 8-12 skills', manifest.skills.length >= 8 && manifest.skills.length <= 12, { count: manifest.skills.length });
  }

  // No third-party skill content in the publish tree: the fetch workdir must be
  // gitignored and MUST NOT appear in the tracked/publish file set.
  const gi = fs.existsSync(path.join(ROOT, '.gitignore')) ? fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8') : '';
  gate.check('.skills-workdir is gitignored', /(^|\n)\/?\.skills-workdir\/?/.test(gi), { hint: 'add /.skills-workdir/ to .gitignore' });
  const scanFiles = listFiles(SCAN_ROOT);
  const leaked = scanFiles.filter((f) => f.includes('.skills-workdir'));
  gate.check('no third-party skill content in publish tree (.skills-workdir absent)', leaked.length === 0, { leaked: leaked.slice(0, 10) });
}

// ── 11. Report #001 receipts + report derivability + band rule + cost ────────
gate.section('report-001 receipts');
{
  const recDir = path.join(ROOT, 'receipts', 'report-001');
  const idxPath = path.join(recDir, '_index.json');
  const reportMd = path.join(ROOT, 'reports', 'report-001.md');
  const costLog = path.join(ROOT, 'reports', 'week-3-cost.md');
  const haveRun = fs.existsSync(idxPath);

  if (!haveRun) {
    gate.check('Report #001 run complete (receipts/report-001/_index.json present)', false, { hint: 'node scripts/run-report-001.js then node scripts/build-report-001.js' });
  } else {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'suites', 'manifest.json'), 'utf8'));
    const pair = manifest.model_pair;

    // Collect skills that have BOTH receipts, validate them, recompute drift.
    const recomputed = [];
    let allValid = true;
    for (const s of manifest.skills) {
      const nP = path.join(recDir, `${s.slug}__${pair.new}.json`);
      const oP = path.join(recDir, `${s.slug}__${pair.old}.json`);
      if (!fs.existsSync(nP) || !fs.existsSync(oP)) continue;
      const rNew = JSON.parse(fs.readFileSync(nP, 'utf8'));
      const rOld = JSON.parse(fs.readFileSync(oP, 'utf8'));
      for (const r of [rNew, rOld]) {
        const v = validateReceipt(r);
        if (!(v.valid && v.version === '0.2' && verifyReceiptHash(r))) allValid = false;
      }
      const drift = buildDriftReport(rOld, rNew, {});
      const reg = drift.perCase.filter((c) => c.verdict === 'regression').length;
      const imp = drift.perCase.filter((c) => c.verdict === 'improvement').length;
      const label = reg && imp ? 'MIXED' : reg ? `REGRESSED (${reg})` : imp ? `IMPROVED (${imp})` : 'WITHIN NOISE';
      recomputed.push({ slug: s.slug, perCase: drift.perCase, label, reg, imp });
    }
    gate.check('every Report #001 receipt validates against schema v0.2 + self-verifies', allValid && recomputed.length > 0, { skills: recomputed.length });
    gate.check('Report #001 covers 8-12 skills', recomputed.length >= 8 && recomputed.length <= 12, { skills: recomputed.length });

    // Band rule: no case marked regression/improvement may have overlapping bands.
    const violations = [];
    for (const s of recomputed) {
      for (const c of s.perCase) {
        if (c.verdict === 'regression' || c.verdict === 'improvement') {
          const a = c.before, b = c.after;
          const sep = (b.mean + b.stddev < a.mean - a.stddev) || (b.mean - b.stddev > a.mean + a.stddev);
          if (!sep) violations.push(`${s.slug}/${c.id}`);
        }
      }
    }
    gate.check('band rule holds: no regression/improvement claimed on overlapping bands', violations.length === 0, { violations });

    // Report derivability: the published report label for a spot-check of 3
    // skills must match the label recomputed straight from the receipts.
    if (fs.existsSync(reportMd)) {
      const md = fs.readFileSync(reportMd, 'utf8');
      const sample = recomputed.slice(0, 3);
      const mismatches = [];
      for (const s of sample) {
        // The summary table row for the skill must carry its recomputed verdict label.
        const rowRe = new RegExp('`' + s.slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '`[^\\n]*' + s.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        if (!rowRe.test(md)) mismatches.push(`${s.slug} (expected "${s.label}")`);
      }
      gate.check('report verdicts derivable from receipts (spot-check 3 skills)', mismatches.length === 0, { mismatches });
    } else {
      gate.check('reports/report-001.md present (run build-report-001.js)', false);
    }
  }

  // Cost log exists and total is within the $40 budget.
  if (fs.existsSync(costLog)) {
    const txt = fs.readFileSync(costLog, 'utf8');
    const est = (txt.match(/TOTAL_METERED_USD_ESTIMATE:\s*([0-9.]+)/) || [])[1];
    const budget = (txt.match(/BUDGET_USD:\s*([0-9.]+)/) || [])[1];
    gate.check('cost log present with parseable total + budget', est != null && budget != null, { est, budget });
    gate.check('projected metered cost within $40 budget', est != null && parseFloat(est) <= 40 && (budget == null || parseFloat(budget) <= 40), { est, budget });
  } else {
    gate.check('reports/week-3-cost.md cost log present', false);
  }
}

// ── 12. Model registry (Week 4) ──────────────────────────────────────────────
gate.section('model registry');
{
  const reg = modelsLib.loadRegistry();
  gate.check('config/models.json loads with >= 8 models', reg.models.length >= 8, { count: reg.models.length });
  // Every entry has the required fields with the right shapes.
  const badRows = [];
  for (const m of reg.models) {
    if (!m.id || !m.family || m.provider !== 'anthropic') badRows.push(`${m.id}: id/family/provider`);
    if (typeof m.input_price !== 'number' || typeof m.output_price !== 'number') badRows.push(`${m.id}: price`);
    if (!['cheap', 'standard', 'frontier'].includes(m.tier)) badRows.push(`${m.id}: tier`);
    if (typeof m.judge_eligible !== 'boolean') badRows.push(`${m.id}: judge_eligible`);
  }
  gate.check('every registry entry has id/family/prices/tier/judge_eligible', badRows.length === 0, { badRows });
  // Resolution: a known alias resolves registered; an unknown id is unregistered.
  gate.check('known model resolves as registered', modelsLib.registryStatus('sonnet') === 'registered' && modelsLib.registryStatus('haiku') === 'registered');
  gate.check('unknown model id marked unregistered', modelsLib.registryStatus('claude-zzz-9') === 'unregistered');
  // The receipt records the registry status.
  const rReg = synthReceipt([mkcase('c', 'with_skill', [0.8, 0.8, 0.8], 0.7), mkcase('c', 'baseline', [0.4, 0.4, 0.4], 0.7)]);
  gate.check('receipt run.registry is a valid enum value', ['registered', 'unregistered'].includes(rReg.run.registry));
  // Cost projection uses the REGISTRY price (haiku = $1/$5 per MTok).
  const haikuPrice = modelsLib.priceForModel('claude-haiku-4-5');
  gate.check('registry price for haiku is $1/$5 per MTok', haikuPrice.input === 1 && haikuPrice.output === 5, haikuPrice);
  // An unregistered id costs at the conservative default (>= any registered price).
  const unregPrice = modelsLib.priceForModel('claude-zzz-9');
  gate.check('unregistered id uses conservative default price (>= frontier)', !unregPrice.registered && unregPrice.input >= 5 && unregPrice.output >= 25, unregPrice);
  const costHaiku = estimateRunCostUSD({ caseCount: 1, samples: 1, models: ['claude-haiku-4-5'], judgeModel: 'claude-haiku-4-5' });
  const costUnreg = estimateRunCostUSD({ caseCount: 1, samples: 1, models: ['claude-zzz-9'], judgeModel: 'claude-haiku-4-5' });
  gate.check('unregistered projection costs strictly more than the haiku one (registry-priced)', costUnreg.totalUSD > costHaiku.totalUSD, { costUnreg: costUnreg.totalUSD, costHaiku: costHaiku.totalUSD });
  // Only the fixed cheap judge is judge_eligible.
  gate.check('haiku is judge_eligible; sonnet/opus are not', modelsLib.isJudgeEligible('claude-haiku-4-5') && !modelsLib.isJudgeEligible('claude-sonnet-5') && !modelsLib.isJudgeEligible('claude-opus-5'));
}

// ── 13. Budget guards (Week 4) ───────────────────────────────────────────────
gate.section('budget guards');
{
  // (a) A synthetic over-cap projection must ABORT before any model call. We
  // spawn the real CLI with a tiny --max-usd; the guard fires pre-call (no model
  // is ever contacted) and exits 3 with no receipts emitted.
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'driftproof-budget-'));
  let aborted = false, exitCode = null, noReceipts = true;
  try {
    execFileSync('node', [
      path.join(ROOT, 'bin', 'driftproof'), 'run', EXAMPLE,
      '--models', 'haiku', '--max-cases', '1', '--samples', '3', '--max-usd', '0.0001', '--out', outDir,
    ], { cwd: ROOT, stdio: 'pipe' });
  } catch (e) {
    exitCode = e.status;
    aborted = /ABORT \(cost guard\)/.test(String(e.stdout || '') + String(e.stderr || ''));
  }
  try { noReceipts = fs.readdirSync(outDir).filter((f) => f.endsWith('.json')).length === 0; } catch (_e) { /* */ }
  gate.check('over-cap projection aborts (exit 3) before any model call', exitCode === 3 && aborted, { exitCode });
  gate.check('aborted run emitted zero receipts (no model call happened)', noReceipts);
  fs.rmSync(outDir, { recursive: true, force: true });

  // (b) Actual-spend hard-stop path, unit-tested with a mocked per-call cost
  // sequence (the same pieces lib/run.js feeds the tracker), stopping at 1.25×.
  const cap = 2;
  const bt = new BudgetTracker(cap);
  const perGen = perCallCostUSD('claude-opus-5', 'gen_with_skill'); // ~expensive
  let threw = null, added = 0;
  try {
    for (let i = 0; i < 100000; i++) { bt.add(perGen); added++; }
  } catch (e) { threw = e; }
  gate.check('BudgetTracker hard-stops with BUDGET_HARDSTOP at 1.25× cap', threw && threw.code === 'BUDGET_HARDSTOP', { code: threw && threw.code });
  gate.check('hard-stop fires only after spend crosses 1.25× cap', bt.spent > cap * 1.25 && (bt.spent - perGen) <= cap * 1.25, { spent: bt.spent, hardCap: cap * 1.25 });
  // A tracker under budget never throws.
  const bt2 = new BudgetTracker(100);
  let ok = true; try { bt2.add(perGen); bt2.add(perGen); } catch (_e) { ok = false; }
  gate.check('BudgetTracker under budget does not throw', ok && bt2.spent > 0);
}

// ── 14. Release trigger (mocked) — draft, notify, DON'T publish ───────────────
// Run the REAL release-watch.js in a child process (synchronous) against a temp
// tree, with a mocked models endpoint, so the whole trigger→prepare-report→draft
// path is exercised offline and the gate stays synchronous.
gate.section('release trigger (mocked)');
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'driftproof-trigger-'));
  const stateDir = path.join(tmp, 'state');
  const regPath = path.join(tmp, 'models.json');
  fs.copyFileSync(path.join(ROOT, 'config', 'models.json'), regPath);
  const outRoot = path.join(tmp, 'out');
  const homeDir = path.join(tmp, 'home'); fs.mkdirSync(homeDir, { recursive: true });
  const modelsFile = path.join(tmp, 'endpoint.json');
  const cur = JSON.parse(fs.readFileSync(regPath, 'utf8')).models.map((m) => ({ id: m.id }));
  fs.writeFileSync(modelsFile, JSON.stringify({ data: [...cur, { id: 'claude-sonnet-6' }] }, null, 2));

  // Snapshot the REAL public-facing surfaces to prove the trigger never touches them.
  const indexPath = path.join(ROOT, 'docs', 'index.html');
  const indexBefore = fs.readFileSync(indexPath, 'utf8');
  const publicIndex = path.join(ROOT, '..', 'driftproof-public', 'docs', 'index.html');
  const publicBefore = fs.existsSync(publicIndex) ? fs.readFileSync(publicIndex, 'utf8') : null;
  const realDraftsBefore = fs.existsSync(path.join(ROOT, 'docs', 'reports')) ? fs.readdirSync(path.join(ROOT, 'docs', 'reports')).filter((n) => /-draft$/.test(n)) : [];

  const runTrigger = (resultFile) => execFileSync('node', [
    path.join(ROOT, 'scripts', 'release-watch.js'),
    '--stub', '--models-file', modelsFile, '--now', '2026-07-29T12:00:00.000Z',
    '--state-dir', stateDir, '--registry', regPath, '--out-root', outRoot, '--home-dir', homeDir,
    '--no-notify', '--result-file', resultFile,
  ], { cwd: ROOT, stdio: 'pipe' });

  const rf1 = path.join(tmp, 'r1.json');
  runTrigger(rf1);
  const r1 = JSON.parse(fs.readFileSync(rf1, 'utf8'));
  gate.check('release-watch detects the new model id', r1.newModels.includes('claude-sonnet-6'), { newModels: r1.newModels });
  gate.check('exactly one draft was triggered', r1.triggered.length === 1, { triggered: r1.triggered.length });
  const tri = r1.triggered[0] || {};
  gate.check('prepare-report paired new vs its family predecessor', tri.oldModel === 'claude-sonnet-5', { old: tri.oldModel });
  gate.check('draft page built under docs/reports/NNN-draft/ (temp out)', !!tri.draftDir && fs.existsSync(path.join(tri.draftDir, 'index.html')), { draftDir: tri.draftDir });
  const draftHtml = tri.draftDir ? fs.readFileSync(path.join(tri.draftDir, 'index.html'), 'utf8') : '';
  gate.check('draft page is noindex (not for the index)', /name="robots" content="noindex"/.test(draftHtml));
  const pending = path.join(outRoot, 'reports', 'pending-publish.md');
  gate.check('pending-publish.md written with an entry for the draft', fs.existsSync(pending) && /Report #\d+ DRAFT ready/.test(fs.readFileSync(pending, 'utf8')));
  gate.check('new model appended to the (temp) registry', JSON.parse(fs.readFileSync(regPath, 'utf8')).models.some((m) => m.id === 'claude-sonnet-6' && m.auto_added));
  gate.check('trigger reports publicTreeTouched === false', tri.publicTreeTouched === false);

  // Assert the REAL site index + public tree were NOT modified.
  gate.check('site index (docs/index.html) is byte-unchanged by the trigger', fs.readFileSync(indexPath, 'utf8') === indexBefore);
  if (publicBefore != null) {
    gate.check('public tree docs/index.html is byte-unchanged by the trigger', fs.readFileSync(publicIndex, 'utf8') === publicBefore);
  } else {
    gate.check('public tree not present locally (nothing for the trigger to touch)', true, { skipped: true });
  }
  const realDraftsAfter = fs.existsSync(path.join(ROOT, 'docs', 'reports')) ? fs.readdirSync(path.join(ROOT, 'docs', 'reports')).filter((n) => /-draft$/.test(n)) : [];
  gate.check('no draft dir was created in the REAL docs/reports tree', realDraftsAfter.length === realDraftsBefore.length, { before: realDraftsBefore, after: realDraftsAfter });

  // ── 15. Idempotency: a second identical run triggers nothing. ───────────────
  gate.section('release trigger idempotency');
  const rf2 = path.join(tmp, 'r2.json');
  runTrigger(rf2);
  const r2 = JSON.parse(fs.readFileSync(rf2, 'utf8'));
  gate.check('second run with the same state finds no new models', r2.newModels.length === 0, { newModels: r2.newModels });
  gate.check('second run triggers nothing', r2.triggered.length === 0, { triggered: r2.triggered.length });

  fs.rmSync(tmp, { recursive: true, force: true });
}

// ── 16. v0.3 fresh-run hashes present for every sample ───────────────────────
gate.section('v0.3 transcript hashes');
{
  const r = synthReceipt([
    mkcase('h1', 'with_skill', [0.8, 0.82, 0.79, 0.81, 0.80], 0.7),
    mkcase('h1', 'baseline', [0.4, 0.41, 0.39, 0.40, 0.42], 0.7),
  ]);
  const hex = /^[a-f0-9]{64}$/;
  let allGen = true, allJudge = true;
  for (const c of r.results.cases) {
    if (!hex.test(c.generation_hash || '')) allGen = false;
    if (!Array.isArray(c.judge_sample_hashes) || c.judge_sample_hashes.length !== c.samples.length || !c.judge_sample_hashes.every((h) => hex.test(h))) allJudge = false;
  }
  gate.check('every case carries a 64-hex generation_hash', allGen);
  gate.check('every case carries one 64-hex judge_sample_hash per sample', allJudge);
}

// ── 17. npm pack whitelist + deny-list + credential-format (BLOCKING) ────────
// The published npm tarball must contain EXACTLY the product whitelist and zero
// repo-internal / deny-listed / credential-shaped content. `npm pack --dry-run
// --json` reports the exact file set without writing a tarball.
gate.section('npm pack whitelist');
{
  let files = null, packErr = null;
  try {
    const out = execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    files = JSON.parse(out)[0].files.map((f) => f.path);
  } catch (e) { packErr = e; }
  gate.check('npm pack --dry-run --json succeeds', !!files && files.length > 0, { packErr: packErr && String(packErr).slice(0, 200) });

  if (files) {
    // Allowed: package.json/README.md/LICENSE (npm always includes), config.js,
    // config/models.json, and anything under bin/ lib/ spec/.
    const ALWAYS = new Set(['package.json', 'README.md', 'LICENSE', 'config.js', 'config/models.json']);
    const ALLOWED_PREFIX = ['bin/', 'lib/', 'spec/'];
    const outside = files.filter((f) => !ALWAYS.has(f) && !ALLOWED_PREFIX.some((p) => f.startsWith(p)));
    gate.check('tarball contains only the whitelist (bin/ lib/ spec/ config.js config/models.json README LICENSE package.json)', outside.length === 0, { outside });

    // Explicit deny: no repo-internal tree may ever be packaged.
    const DENY_DIR = ['receipts/', 'reports/', 'suites/', 'docs/', 'scripts/', 'tests/', 'deploy/', 'examples/', 'state/', 'transcripts/', '.github/', 'node_modules/', '.skills-workdir'];
    const denied = files.filter((f) => DENY_DIR.some((d) => f.startsWith(d) || f.includes('/' + d)));
    gate.check('tarball excludes every repo-internal/deny-list directory', denied.length === 0, { denied });

    // config/ carries ONLY models.json (no config.js leak into config/, no other cfg).
    const cfgFiles = files.filter((f) => f.startsWith('config/'));
    gate.check('config/ in tarball is exactly [config/models.json]', cfgFiles.length === 1 && cfgFiles[0] === 'config/models.json', { cfgFiles });

    // Essentials the CLI needs at runtime are all present.
    const NEED = ['package.json', 'README.md', 'LICENSE', 'config.js', 'config/models.json', 'bin/driftproof', 'lib/run.js', 'lib/verdict.js', 'lib/stub.js', 'lib/init.js', 'spec/receipt.schema.json'];
    const missing = NEED.filter((n) => !files.includes(n));
    gate.check('tarball includes every runtime essential (bin/config/spec/verdict/stub/init)', missing.length === 0, { missing });

    // Deny-list + credential-format scan over the PACKED file CONTENTS.
    const dec = (b64) => JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    const SUBSTR = dec('WyJTZWF0cml1bSIsIk11c2ltIE1hcyIsIlBhbmFzb25pYyIsIkJvbHR0ZWNoIiwiQ2hhcmxlcyBhbmQgS2VpdGgiLCJTdW5saWZlIiwiSnVyb25nIFBvcnQiLCJUZWxlLWNlbnRyZSIsIldyaXNlIiwiQXlhbGEiLCJTaW5hciBNYXMiLCJTb2Z0d2FyZU9uZSIsInNvZnR3YXJlb25lIl0=');
    const WORD = dec('WyJSR0UiLCJPRkkiLCJSSEIiLCJTQkYiLCJNQlMiLCJTSUEiLCJUUEwiLCJQRUFNIiwiQURCIiwiU1cxIl0=');
    const CRED = [
      /\b(sk|pk|rk)_(live|test)_[0-9A-Za-z]{16,}\b/, /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
      /\bAKIA[0-9A-Z]{16}\b/, /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/, /\bAIza[0-9A-Za-z_-]{35}\b/,
      /\bsk-(ant-)?[A-Za-z0-9]{24,}\b/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    ];
    const contentHits = [];
    for (const rel of files) {
      let c; try { c = fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch (_e) { continue; }
      for (const t of SUBSTR) if (c.toLowerCase().includes(t.toLowerCase())) contentHits.push({ rel, term: t });
      for (const t of WORD) if (new RegExp(`\\b${t}\\b`).test(c)) contentHits.push({ rel, term: t });
      for (const re of CRED) if (re.test(c)) contentHits.push({ rel, term: `cred:${re}` });
    }
    gate.check('packed file contents are deny-list + credential-format clean', contentHits.length === 0, { contentHits: contentHits.slice(0, 20) });
  }
}

// ── 18. `driftproof init` scaffolds correctly and never overwrites (unit) ─────
gate.section('init scaffolding');
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'driftproof-init-'));
  try {
    const dir = path.join(tmp, 'my-skill');
    const r1 = scaffoldInit(dir);
    const rels = r1.created.map((f) => path.relative(dir, f)).sort();
    gate.check('init creates SKILL.md + evals/evals.json + .driftproofrc', JSON.stringify(rels) === JSON.stringify(['.driftproofrc', 'SKILL.md', 'evals/evals.json'].sort()), { rels });
    gate.check('init reports nothing skipped on a fresh dir', r1.skipped.length === 0, { skipped: r1.skipped });

    // The scaffolded suite is loadable and has 3 cases anchored at 0.80.
    const suiteRaw = JSON.parse(fs.readFileSync(path.join(dir, 'evals', 'evals.json'), 'utf8'));
    const cases = normalizeCases(suiteRaw);
    gate.check('scaffolded suite normalizes to 3 cases', cases.length === 3, { n: cases.length });
    gate.check('every scaffolded rubric carries the 0.80 scoring anchor', cases.every((c) => /0\.80/.test(c.rubric)), {});
    // A full loadSkill() works on the scaffold (proves it is a runnable skeleton).
    const { loadSkill } = require('../lib/skill');
    let loaded = null; try { loaded = loadSkill(dir); } catch (_e) { /* */ }
    gate.check('loadSkill() succeeds on the scaffolded skeleton', !!loaded && loaded.suite.caseCount === 3, { ok: !!loaded });

    // Never overwrites: hand-edit a file, re-run, assert byte-identical + reported skipped.
    const skillPath = path.join(dir, 'SKILL.md');
    fs.writeFileSync(skillPath, 'CUSTOM CONTENT — must be preserved\n');
    const before = fs.readFileSync(skillPath, 'utf8');
    const r2 = scaffoldInit(dir);
    gate.check('re-running init creates nothing', r2.created.length === 0, { created: r2.created });
    gate.check('re-running init skips all 3 existing files', r2.skipped.length === 3, { skipped: r2.skipped.length });
    gate.check('init NEVER overwrites an existing file (byte-identical)', fs.readFileSync(skillPath, 'utf8') === before);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ── 19. Packed CLI runs from a tmpdir OUTSIDE the repo (stub, BLOCKING) ───────
// Pack a real tarball, extract it outside the repo, give it the deps via a
// node_modules symlink (offline), and run stub-mode from an unrelated CWD. Proves
// the packaged file set alone runs — spec/schema/registry resolve from the
// package, receipts land in the user's CWD — exactly the global/npx-install path.
gate.section('packed CLI from outside repo');
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'driftproof-pack-'));
  try {
    execFileSync('npm', ['pack', '--pack-destination', tmp], { cwd: ROOT, stdio: ['ignore', 'ignore', 'ignore'] });
    const tgz = fs.readdirSync(tmp).find((f) => f.endsWith('.tgz'));
    gate.check('npm pack produced a tarball', !!tgz, { files: fs.readdirSync(tmp) });
    if (tgz) {
      const pkgRoot = path.join(tmp, 'unpacked');
      fs.mkdirSync(pkgRoot, { recursive: true });
      execFileSync('tar', ['xzf', path.join(tmp, tgz), '-C', pkgRoot], { stdio: 'ignore' });
      const pkgDir = path.join(pkgRoot, 'package');
      // Offline deps: symlink the repo's node_modules into the extracted package.
      fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(pkgDir, 'node_modules'));
      const work = path.join(tmp, 'work');
      fs.mkdirSync(work, { recursive: true });
      execFileSync('node', [
        path.join(pkgDir, 'bin', 'driftproof'), 'run', EXAMPLE,
        '--models', 'claude-haiku-4-5', '--max-cases', '1', '--samples', '1', '--max-usd', '2',
      ], { cwd: work, env: { ...process.env, DRIFTPROOF_STUB: '1' }, stdio: 'ignore' });
      const emitted = fs.existsSync(path.join(work, 'receipts')) ? fs.readdirSync(path.join(work, 'receipts')).filter((f) => f.endsWith('.json')) : [];
      gate.check('packed CLI emitted a receipt into the CWD (not the package dir)', emitted.length >= 1, { emitted });
      let ok = emitted.length > 0;
      for (const f of emitted) {
        const r = JSON.parse(fs.readFileSync(path.join(work, 'receipts', f), 'utf8'));
        if (!validateReceipt(r).valid || !verifyReceiptHash(r)) ok = false;
      }
      gate.check('packed-CLI receipt validates + self-verifies', ok);
      // The package dir must NOT have accreted a receipts/ dir (proves CWD-relative output).
      gate.check('packed CLI wrote nothing into the package dir', !fs.existsSync(path.join(pkgDir, 'receipts')));
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ── 20. GitHub Action + selftest workflow (BLOCKING) ─────────────────────────
gate.section('github action');
{
  const actionPath = path.join(ROOT, 'action.yml');
  const a = fs.existsSync(actionPath) ? fs.readFileSync(actionPath, 'utf8') : '';
  gate.check('action.yml present at repo root', !!a);
  gate.check('action is a composite action', /using:\s*'?composite'?/.test(a));
  gate.check('action declares inputs skill-dir + max-usd(default 2) + api-key + fail-on-regression', /skill-dir:/.test(a) && /max-usd:[\s\S]*default:\s*'2'/.test(a) && /api-key:/.test(a) && /fail-on-regression:/.test(a));
  gate.check('action outputs verdict + delta', /outputs:[\s\S]*verdict:[\s\S]*delta:/.test(a));
  gate.check('action runs bin/driftproof + badge + uploads the receipt artifact', /bin\/driftproof/.test(a) && /badge/.test(a) && /upload-artifact/.test(a));
  gate.check('action fails the job on REGRESSED (guarded by fail-on-regression)', /fail-on-regression/.test(a) && /REGRESSED/.test(a) && /exit 1/.test(a));

  // GitHub Marketplace listing requirements (locked here so a future edit can't
  // silently break the listing): a short unique name, a description within the
  // 125-char Marketplace limit, and branding with an allowed icon + color.
  const ALLOWED_COLORS = new Set(['white', 'yellow', 'blue', 'green', 'orange', 'red', 'purple', 'gray-dark']);
  const ALLOWED_ICONS = new Set(['shield', 'check-circle']); // the two verification-appropriate options we vet
  const nameM = a.match(/^name:\s*'([^']*)'/m);
  const descM = a.match(/^description:\s*'((?:[^']|'')*)'/m);
  const iconM = a.match(/^\s*icon:\s*'([^']*)'/m);
  const colorM = a.match(/^\s*color:\s*'([^']*)'/m);
  const desc = descM ? descM[1].replace(/''/g, "'") : '';
  gate.check('action name present and short (Marketplace unique-ish title)', !!nameM && nameM[1].length > 0 && nameM[1].length <= 40, { name: nameM && nameM[1] });
  gate.check('action description present and within Marketplace 125-char limit', !!descM && desc.length > 0 && desc.length <= 125, { len: desc.length });
  gate.check('branding icon present and from the vetted allowed set', !!iconM && ALLOWED_ICONS.has(iconM[1]), { icon: iconM && iconM[1] });
  gate.check('branding color present and from the GitHub allowed palette', !!colorM && ALLOWED_COLORS.has(colorM[1]), { color: colorM && colorM[1] });
  gate.check('action declares an author (Marketplace attribution)', /^author:\s*'\S/m.test(a));

  const wf = path.join(ROOT, '.github', 'workflows', 'action-selftest.yml');
  const w = fs.existsSync(wf) ? fs.readFileSync(wf, 'utf8') : '';
  gate.check('action-selftest workflow present', !!w);
  gate.check('selftest uses the local action (uses: ./) in stub mode', /uses:\s*\.\//.test(w) && /DRIFTPROOF_STUB:\s*'1'/.test(w));
  gate.check('selftest runs the bundled example skill and asserts PASSED', /examples\/commit-message-conventions/.test(w) && /PASSED/.test(w));

  // Local stub run == what the action does: run → badge → verdict.
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'driftproof-action-'));
  try {
    execFileSync('node', [path.join(ROOT, 'bin', 'driftproof'), 'run', EXAMPLE, '--models', 'claude-haiku-4-5', '--max-cases', '2', '--samples', '1', '--max-usd', '2', '--out', outDir],
      { cwd: ROOT, env: { ...process.env, DRIFTPROOF_STUB: '1' }, stdio: 'ignore' });
    const rf = fs.readdirSync(outDir).filter((f) => f.endsWith('.json') && !f.endsWith('.summary.md'))[0];
    const receipt = JSON.parse(fs.readFileSync(path.join(outDir, rf), 'utf8'));
    const v = verdictFromReceipt(receipt);
    gate.check('local stub run yields verdict PASSED on the example skill', v.verdict === 'PASSED', { v });
    gate.check('badge --github-output emits verdict=PASSED', /verdict=PASSED/.test(githubOutputLines(receipt)));
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}

// ── 21. Badge JSON validates against the shields endpoint schema (BLOCKING) ───
gate.section('badge shields schema');
{
  // Minimal shields.io "endpoint" schema: schemaVersion===1, string label +
  // message, optional string color.
  const COLORS = new Set(['brightgreen', 'green', 'yellowgreen', 'yellow', 'orange', 'red', 'lightgrey', 'blue', 'success', 'important', 'critical', 'informational', 'inactive']);
  const validShields = (b) => b && b.schemaVersion === 1 && typeof b.label === 'string' && typeof b.message === 'string' && typeof b.color === 'string';

  const pass = synthReceipt([mkcase('x', 'with_skill', [0.85, 0.85, 0.85], 0.7), mkcase('x', 'baseline', [0.42, 0.42, 0.42], 0.7)]);
  const noeff = synthReceipt([mkcase('x', 'with_skill', [0.80, 0.80, 0.80], 0.7), mkcase('x', 'baseline', [0.79, 0.79, 0.79], 0.7)]);
  const regr = synthReceipt([mkcase('x', 'with_skill', [0.40, 0.40, 0.40], 0.7), mkcase('x', 'baseline', [0.80, 0.80, 0.80], 0.7)]);
  const bp = badgeEndpoint(pass), bn = badgeEndpoint(noeff), br = badgeEndpoint(regr);
  gate.check('badge for a lifting skill validates + is green', validShields(bp) && bp.color === 'brightgreen', bp);
  gate.check('badge below the effect floor is NO_EFFECT/grey', validShields(bn) && bn.color === 'lightgrey' && verdictFromReceipt(noeff).verdict === 'NO_EFFECT', bn);
  gate.check('badge for a hurting skill is REGRESSED/red', validShields(br) && br.color === 'red' && verdictFromReceipt(regr).verdict === 'REGRESSED', br);
  gate.check('badge color is a known shields color', COLORS.has(bp.color) && COLORS.has(bn.color) && COLORS.has(br.color));

  // The committed living-demo badge is present and valid.
  const demo = path.join(ROOT, 'docs', 'badges', 'commit-message-conventions.json');
  const d = fs.existsSync(demo) ? JSON.parse(fs.readFileSync(demo, 'utf8')) : null;
  gate.check('committed example badge (docs/badges/commit-message-conventions.json) is valid shields JSON', validShields(d) && d.label === 'driftproof', { d });
}

// ── 22. Single-receipt verdict logic (unit) ──────────────────────────────────
gate.section('verdict logic');
{
  const mk = (w, b, model) => {
    const r = synthReceipt([mkcase('c', 'with_skill', [w, w, w], 0.7), mkcase('c', 'baseline', [b, b, b], 0.7)]);
    r.run.model_id = model || r.run.model_id; return r;
  };
  gate.check('delta >= 0.05 → PASSED', verdictFromReceipt(mk(0.85, 0.42)).verdict === 'PASSED');
  gate.check('|delta| < 0.05 → NO_EFFECT', verdictFromReceipt(mk(0.80, 0.78)).verdict === 'NO_EFFECT');
  gate.check('delta <= -0.05 → REGRESSED', verdictFromReceipt(mk(0.40, 0.80)).verdict === 'REGRESSED');
  gate.check('a move of exactly the floor (0.05) counts as PASSED (inclusive)', verdictFromReceipt(mk(0.80, 0.75)).verdict === 'PASSED');
  gate.check('badge model name strips a trailing -YYYYMMDD', verdictFromReceipt(mk(0.85, 0.42, 'claude-haiku-4-5-20251001')).model === 'claude-haiku-4-5');
}

// ── file listing ─────────────────────────────────────────────────────────────
function listFiles(root) {
  try {
    const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' });
    const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' });
    return [...new Set((tracked + untracked).split('\n').map((s) => s.trim()).filter(Boolean))];
  } catch (_e) {
    return walk(root).map((p) => path.relative(root, p));
  }
}
function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc); else acc.push(p);
  }
  return acc;
}

const summary = gate.summarize();
fs.writeFileSync(path.join(__dirname, 'gate-results.json'), JSON.stringify(summary, null, 2));
process.exit(gate.toExitCode());
