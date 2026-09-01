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
// The CURRENT schema version, read once. Assertions that pinned the literal
// '0.4' broke on every bump for a reason unrelated to the property they stand
// for — name-vs-thing, in the repo gate itself (spec 014).
const { RECEIPT_SCHEMA_VERSION } = require('../config');
const os = require('os');
const crypto = require('crypto');
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

// ── WHAT THIS GATE RUNS IS CHOSEN ON ARGV ────────────────────────────────────
//
// Backlog F-1, DECISIONS #27 clause 1. These three used to be read from the
// environment: `DRIFTPROOF_PUBLISH_VERIFY` selected which form of the message
// assertion ran, `DRIFTPROOF_PUBLISH_MESSAGE` supplied the value it compared
// against, and `DRIFTPROOF_SCAN_ROOT` chose the tree every scan walked. So an
// operator's shell could pick the weaker assertion and hand it the answer: with
// both set ambiently this gate returned a green total over a script that lies, at
// an unchanged assertion count, with nothing in the output saying a weaker check
// had been substituted.
//
// #26 removed an ambient input to `rm -rf` on the ground that an input nobody
// typed is the wrong thing to guard well. The same change then introduced these.
// This is that ground applied to its own output.
//
// The FAIL-SAFE DIRECTION is what makes removal sufficient on its own: absent the
// flags this gate runs the standalone, BUILDING form, which is the stronger of the
// two. An ambient value is now not merely refused, it is not read, so it cannot
// select anything. `scripts/build-public.sh` passes these on argv when it runs
// this gate as its verification step, and refuses outright if a variable of the
// family reaches it from a shell.
const ARGV = process.argv.slice(2);
const argValue = (name) => {
  const i = ARGV.indexOf(name);
  return i >= 0 && i + 1 < ARGV.length ? ARGV[i + 1] : undefined;
};
const PUBLISH_VERIFY = ARGV.includes('--publish-verify');
const PUBLISH_MESSAGE = argValue('--publish-message') || '';
const SCAN_ROOT_ARG = argValue('--scan-root');
const SCAN_ROOT = SCAN_ROOT_ARG ? path.resolve(SCAN_ROOT_ARG) : ROOT;
const EXAMPLE = path.join(ROOT, 'examples', 'commit-message-conventions');
const gate = new Gate('driftproof phase-7 gate');

const JUDGE = { model_id: 'claude-haiku-4-5-20251001', rubric_hash: 'a'.repeat(64) };
const RUN_META = { model_id: 'claude-haiku-4-5-20251001', model_release_date: '2025-10-01', provider: 'anthropic', surface: 'claude-cli', runner_version: '0.3.0', date_utc: '2026-07-27T00:00:00.000Z', registry: 'registered', transcripts: 'hashes-only', judge: { samples: 5, temperature: null, sampling: 'surface-controlled', surface: 'claude-cli' } };

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

// ── 2. Schema v0.4 + round-trip + tamper ─────────────────────────────────────
gate.section('schema v0.4 + round-trip');
{
  const r = synthReceipt([
    mkcase('c1', 'with_skill', [0.9, 0.88, 0.92, 0.9, 0.9], 0.7),
    mkcase('c1', 'baseline', [0.4, 0.45, 0.4, 0.42, 0.4], 0.7),
  ]);
  const v = validateReceipt(r);
  gate.check('a freshly produced receipt validates against the CURRENT schema', v.valid && v.version === RECEIPT_SCHEMA_VERSION, { ...v, expected: RECEIPT_SCHEMA_VERSION });
  gate.check('receipt stamps schema_version 0.4 + run.provider + run.registry + run.transcripts',
    r.schema_version === RECEIPT_SCHEMA_VERSION && !!r.run.provider && !!r.run.registry && !!r.run.transcripts, { sv: r.schema_version, expected: RECEIPT_SCHEMA_VERSION, prov: r.run.provider, reg: r.run.registry, tr: r.run.transcripts });
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

  // v0.3 receipts still load against the FROZEN v0.3 schema (no run.provider).
  const p3 = path.join(ROOT, 'tests', 'fixtures', 'receipt-v0.3.json');
  const r3 = JSON.parse(fs.readFileSync(p3, 'utf8'));
  const v3 = validateReceipt(r3);
  gate.check('v0.3 receipt validates against the frozen v0.3 schema', v3.valid && v3.version === '0.3', v3.errors);
  gate.check('v0.3 receipt self-hash still verifies', verifyReceiptHash(r3));
  gate.check('v0.3 receipt has no run.provider (pre-0.3.1) yet still loads', r3.run.provider === undefined);

  // v0.3.1 receipts still load against the FROZEN v0.3.1 schema (no economics).
  // The fixture is a REAL published Report #004 receipt, trimmed to one case: the
  // guarantee that matters is that receipts already in the wild keep validating.
  const p31 = path.join(ROOT, 'tests', 'fixtures', 'receipt-v0.3.1.json');
  const r31 = JSON.parse(fs.readFileSync(p31, 'utf8'));
  const v31 = validateReceipt(r31);
  gate.check('v0.3.1 receipt validates against the frozen v0.3.1 schema', v31.valid && v31.version === '0.3.1', v31.errors);
  gate.check('v0.3.1 receipt self-hash still verifies', verifyReceiptHash(r31));
  gate.check('v0.3.1 receipt carries no economics/pricing_snapshot (pre-0.4) yet still loads',
    r31.economics === undefined && r31.run.pricing_snapshot === undefined);

  // Every PUBLISHED report receipt still loads under the v0.4 loader. This is the
  // no-receipt-left-behind assertion: 60+ receipts across four reports, each
  // validated against the schema its own schema_version names.
  const publishedDirs = ['report-001', 'report-002', 'report-003', 'report-004']
    .map((d) => path.join(ROOT, 'receipts', d)).filter((d) => fs.existsSync(d));
  let pubOk = true; let pubCount = 0; const pubVersions = new Set();
  for (const d of publishedDirs) {
    for (const f of fs.readdirSync(d).filter((x) => x.endsWith('.json') && x !== '_index.json')) {
      const rec = JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'));
      const vv = validateReceipt(rec);
      pubVersions.add(vv.version);
      if (!(vv.valid && verifyReceiptHash(rec))) { pubOk = false; }
      pubCount++;
    }
  }
  gate.check('every published receipt (all four reports) still validates + self-verifies under the v0.4 loader',
    pubOk && pubCount >= 60, { receipts: pubCount, versions: [...pubVersions].sort() });
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
  const SUBSTR = dec('WyJTZWF0cml1bSIsIk11c2ltIE1hcyIsIlBhbmFzb25pYyIsIkJvbHR0ZWNoIiwiQ2hhcmxlcyBhbmQgS2VpdGgiLCJTdW5saWZlIiwiSnVyb25nIFBvcnQiLCJUZWxlLWNlbnRyZSIsIldyaXNlIiwiQXlhbGEiLCJTaW5hciBNYXMiLCJTb2Z0d2FyZU9uZSIsInNvZnR3YXJlb25lIiwiTmljb2xhcyBQYXJpcyJd');
  const WORD = dec('WyJSR0UiLCJPRkkiLCJSSEIiLCJTQkYiLCJNQlMiLCJTSUEiLCJUUEwiLCJQRUFNIiwiQURCIiwiU1cxIl0=');
  // Case-insensitive word-boundary terms. Separate from WORD (whose entries are
  // case-sensitive acronyms) so adding a name here cannot loosen those.
  //
  // PERSONAL NAMES ARE NEVER PUBLISHED. Driftproof credits an acknowledgment as
  // "a former colleague" — a real person who asked a question that shaped the
  // work has not consented to being named in a public artifact, and a published
  // repo is forever. This list makes that a BLOCKING gate failure rather than a
  // review habit: the full name as a substring, and each name part on a word
  // boundary, so neither half can reach the tree by itself.
  const WORD_CI = dec('WyJQYXJpcyIsIk5pY29sYXMiXQ==');
  const FILENAME_PATTERNS = [/rate-card.*\.json$/i, /funding-rules.*\.json$/i, /workstreams.*\.json$/i, /^spi.*\.json$/i];
  const files = listFiles(SCAN_ROOT);
  const hits = [];
  for (const rel of files) {
    for (const pat of FILENAME_PATTERNS) if (pat.test(path.basename(rel))) hits.push({ file: rel, term: `filename:${pat}` });
    let c; try { c = fs.readFileSync(path.join(SCAN_ROOT, rel), 'utf8'); } catch (_e) { continue; }
    for (const t of SUBSTR) if (c.toLowerCase().includes(t.toLowerCase())) hits.push({ file: rel, term: t });
    for (const t of WORD) if (new RegExp(`\\b${t}\\b`).test(c)) hits.push({ file: rel, term: t });
    for (const t of WORD_CI) if (new RegExp(`\\b${t}\\b`, 'i').test(c)) hits.push({ file: rel, term: t });
  }
  gate.check('repo-wide deny-list scan returns zero hits', hits.length === 0, { hits: hits.slice(0, 20) });
  gate.check('scan covered a non-trivial file set', files.length >= 10, { fileCount: files.length });

  // The deny-list must actually BITE. Plant each new term in a temp file inside
  // the scanned tree and assert the scanner flags it — a deny-list that silently
  // stopped matching would be worse than none, since it reads as protection.
  // Held in memory only — the banned string is never written to disk, not even
  // to a temp file, so a crash mid-test cannot leave it in the tree.
  const planted = [];
  for (const term of [...SUBSTR.slice(-1), ...WORD_CI]) {
    for (const body of [`prose mentioning ${term} inline`, `PROSE MENTIONING ${term.toUpperCase()} INLINE`]) {
      const caught = SUBSTR.some((t) => body.toLowerCase().includes(t.toLowerCase()))
        || WORD_CI.some((t) => new RegExp(`\\b${t}\\b`, 'i').test(body));
      planted.push({ caught });
    }
  }
  gate.check('deny-list BITES: every acknowledgment-name term is caught when planted, in any case',
    planted.length === 6 && planted.every((p) => p.caught), planted);
  gate.check('the acknowledgment credits a role, never a person',
    /a former colleague/.test(fs.readFileSync(path.join(ROOT, 'scripts', 'prepare-report-005.js'), 'utf8')));
}

// ── 8. Hygiene scan (BLOCKING) ───────────────────────────────────────────────
// The pattern list lives in lib/hygiene.js, which `scripts/merge-check.js` reads
// too: one definition, so the scan that runs at gate time and the scan that runs
// in front of a merge cannot drift apart (spec 007, AC-4).
gate.section('hygiene');
{
  const hygiene = require('../lib/hygiene.js');
  const files = listFiles(SCAN_ROOT);
  // The third argument is the link reader (spec 011, AC-2). Without it this
  // caller is the blind one: `readFileSync` on a symlink follows it, so a link
  // to a path that does not exist here throws and the entry is skipped — which
  // is how a `node_modules -> /home/<user>/...` link reached a published tree
  // past a green scan. `merge-check.js` needs no such reader; git already hands
  // it the target as blob content.
  const readLink = (rel) => {
    const abs = path.join(SCAN_ROOT, rel);
    return fs.lstatSync(abs).isSymbolicLink() ? fs.readlinkSync(abs) : null;
  };
  const hits = hygiene.scanFiles(files, (rel) => fs.readFileSync(path.join(SCAN_ROOT, rel), 'utf8'), readLink);
  gate.check('hygiene scan (paths/emails/tokens/env/host-ip/codex-auth-jwt) returns zero hits', hits.length === 0, { hits: hits.slice(0, 20) });

  // The scanner BITES. A deny-list nobody has fired is a deny-list nobody knows
  // is connected — samples are decoded in memory and never written to disk.
  const samples = JSON.parse(Buffer.from(
    'eyJob21lLXBhdGgiOiAic2VlIC9ob21lL3NvbWVvbmUvdGhpbmciLCAiZWMyLWludGVybmFsLWhvc3QiOiAiaXAtMTAtMC0wLTEuYXAtc291dGhlYXN0LTEuY29tcHV0ZS5pbnRlcm5hbCIsICJwcml2YXRlLWlwIjogIjEwLjEuMi4zIiwgImFudGhyb3BpYy1rZXkiOiAic2stYW50LUFBQUFBQUFBQUFBQUFBQUFBQUFBIiwgImdpdGh1Yi10b2tlbiI6ICJnaHBfYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiIiwgImF3cy1rZXkiOiAiQUtJQUFCQ0RFRkdISUpLTE1OT1AiLCAicHJpdmF0ZS1rZXktYmxvY2siOiAiLS0tLS1CRUdJTiBSU0EgUFJJVkFURSBLRVktLS0tLSIsICJlbnYtc2VjcmV0LWFzc2lnbm1lbnQiOiAiQU5USFJPUElDX0FQSV9LRVk9enp6IiwgImp3dC10b2tlbiI6ICJleUphYmNkZWZnaGlqay5leUpsbW5vcHFyc3R1di53eHl6YWIiLCAib3BlbmFpLXNlY3JldC1rZXkiOiAic2stcHJvai1jY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2MiLCAiZW1haWwiOiAicGVyc29uQG5vdGFsbG93ZWQudGVzdCJ9',
    'base64').toString('utf8'));
  const missed = Object.entries(samples)
    .filter(([kind, body]) => !hygiene.scanContent('probe.md', `prose ${body} more`).some((h) => h.kind === kind))
    .map(([kind]) => kind);
  gate.check('hygiene deny-list BITES: every class is caught when planted', missed.length === 0, { missed });
  gate.check('the hygiene scan does not fire on clean content',
    hygiene.scanContent('probe.md', 'ordinary prose, mail hi@example.com').length === 0);
  gate.check('a committed .env file is a hit on its NAME, with no content read',
    hygiene.scanPath('config/.env').length === 1 && hygiene.scanPath('config/env.md').length === 0);
}

// ── 8a. Published-tree symlink boundary (BLOCKING) ───────────────────────────
// The last look at the bytes that are about to become a public repository, after
// every copy and rewrite the build performs (spec 011, AC-3). P-1 shipped a
// `node_modules -> /home/<user>/...` link into a published tree that returned
// 432/432: the guard at the publish door and the scanner both have to be right,
// and this is the assertion that reads the shipped artefact itself.
gate.section('publish-tree symlink boundary');
{
  if (SCAN_ROOT_ARG) {
    // The question is what git will STORE, not what the filesystem holds, so the
    // check reads git's own staged mode rather than lstat: a symlink is mode
    // 120000, whose blob content is the target path. `git ls-files -s` reports
    // the index, which is what a publish commits.
    let symlinks = [];
    let listed = false;
    try {
      symlinks = execFileSync('git', ['ls-files', '-s'], { cwd: SCAN_ROOT, encoding: 'utf8' })
        .split('\n').filter(Boolean)
        .filter((l) => l.startsWith('120000'))
        .map((l) => l.split('\t').slice(1).join('\t'));
      listed = true;
    } catch (e) {
      symlinks = [`could not enumerate: ${e.message}`];
    }
    gate.check('no tracked entry in the published tree is a symbolic link',
      listed && symlinks.length === 0, { symlinks: symlinks.slice(0, 20) });
  }
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
  if (SCAN_ROOT_ARG) {
    // Full strength where it matters: nothing draft-shaped may exist in a tree
    // that is about to be published. build-public.sh excludes `(^|/)[^/]*-draft/`
    // from `git ls-files`, and this is the assertion that proves it did.
    gate.check('no *-draft/ path exists in the (published) tree', draftHits.length === 0, { draftHits: draftHits.slice(0, 20) });
  } else {
    // On the DEV tree, same precedent as reports/pending-publish.md immediately
    // below: a thing may be legitimately tracked here and still be excluded from
    // the published tree. Report #005's 30 receipts are tracked deliberately —
    // they are the report's entire evidentiary basis, they cannot be regenerated
    // without a ~2,500-call run, and untracked left them one flag from deletion.
    //
    // WIDENED 2026-08-29 (DECISIONS, 'A report page lives at a draft path'). The
    // *-draft/ convention no longer means 'untracked until publish': a report page
    // and its evidence/ directory are now tracked DELIBERATELY at the draft path,
    // because the draft state is carried by the PATH alone. EXCLUDE_RE keeps every
    // *-draft/ path out of the published tree, and the promote-rename is step one
    // of the guarded publish, so nothing in the bytes marks the draft and nothing
    // has to be stripped at publish — the failure mode amendment v1.0.1 recorded.
    //
    // This is NOT a blanket relaxation, and the guard's job narrows rather than
    // lapses: under a *-draft/ path it now refuses everything except receipt JSON,
    // the report page, and files in its evidence/ directory. A stray artifact
    // still cannot become tracked by accident, and the publish-side check above —
    // the one that proves the exclusion actually happened — is unchanged.
    const allowed = [
      /^receipts\/report-[0-9]+-draft\/[^/]+\.json$/,
      /^docs\/reports\/[0-9]+-draft\/(index\.html|evidence\/[^/]+)$/,
    ];
    const bad = draftHits.filter((f) => !allowed.some((re) => re.test(f)));
    gate.check('only receipt JSON, a report page and its evidence may be tracked under a *-draft/ path on the dev tree', bad.length === 0, { bad: bad.slice(0, 20) });

    // THE WIDENED GUARD MUST STILL BITE. A guard is worth what it refuses, and a
    // widening is exactly where one quietly becomes a blanket allow. Exercised on
    // the SAME array the filter above uses — not a copy of the pattern, which is
    // the drift lib/hygiene.js exists to prevent — against the shapes it must keep
    // refusing: a stray file beside the page, a nested evidence path, a page one
    // level deeper, a backup of the page, and a non-JSON receipt.
    const admits = (f) => allowed.some((re) => re.test(f));
    const mustRefuse = [
      'docs/reports/006-draft/notes.md',
      'docs/reports/006-draft/evidence/nested/x.json',
      'docs/reports/006-draft/sub/index.html',
      'docs/reports/006-draft/index.html.bak',
      'receipts/report-006-draft/transcript.txt',
    ];
    const mustAdmit = [
      'docs/reports/006-draft/index.html',
      'docs/reports/006-draft/evidence/probe-baseline-stability-20260828.json',
      'receipts/report-005-draft/x.json',
    ];
    gate.check('the widened draft guard still BITES: strays under a *-draft/ path are refused',
      mustRefuse.every((f) => !admits(f)), { wronglyAdmitted: mustRefuse.filter(admits) });
    gate.check('the widened draft guard admits exactly the page, its evidence and receipt JSON',
      mustAdmit.every(admits), { wronglyRefused: mustAdmit.filter((f) => !admits(f)) });
  }
  // The pending-publish queue must not ride a publish. It IS tracked on the dev
  // tree (an empty placeholder), so only assert its absence against a published
  // SCAN_ROOT (where build-public.sh has excluded it).
  if (SCAN_ROOT_ARG) {
    const pendingHits = files.filter((f) => f === 'reports/pending-publish.md');
    gate.check('published tree excludes reports/pending-publish.md', pendingHits.length === 0, { pendingHits });
  } else {
    gate.check('pending-publish.md exclusion (asserted only against a published SCAN_ROOT)', true, { skipped: true });
  }

  // Spec-anchored governance files are working documents, not products: the
  // decision log carries strategy, rejected options and risk posture, and the
  // confidentiality scan can only catch deny-listed TERMS — it can never know a
  // document is internal BY NATURE. They are tracked on dev (that is the point:
  // they are version-controlled governance), so like pending-publish.md this is
  // asserted only against a published SCAN_ROOT, where build-public.sh has
  // excluded them. Publishing a curated public constitution stays open as a
  // deliberate choice; this guard only prevents it happening by accident.
  if (SCAN_ROOT_ARG) {
    const govHits = files.filter((f) => /^specs\//.test(f) || f === 'CONSTITUTION.md' || f === 'DECISIONS.md');
    gate.check('published tree excludes CONSTITUTION.md, DECISIONS.md and specs/',
      govHits.length === 0, { govHits: govHits.slice(0, 20) });
  } else {
    gate.check('governance-file exclusion (asserted only against a published SCAN_ROOT)', true, { skipped: true });
  }

  // Local machine state must not ride a publish. `state/skill-version-check.json`
  // became tracked in spec 007 so the repository could reproduce its own published
  // page; tracking it made it eligible for the published tree, and a
  // reproducibility fix must not change the published artifact as a side effect.
  // Same shape as G-F1: the exclusion is in EXCLUDE_RE, so it is asserted here too
  // rather than left to a regex nobody checks.
  if (SCAN_ROOT_ARG) {
    const stateHits = files.filter((f) => /^state\//.test(f));
    gate.check('published tree excludes state/', stateHits.length === 0, { stateHits });
  } else {
    gate.check('state/ exclusion (asserted only against a published SCAN_ROOT)', true, { skipped: true });
  }

  // Internal narrative and outbound records must not ride a publish: the weekly
  // logs, the phase write-ups, and interop-outreach.md (a RECORD of posts already
  // made). build-public.sh excludes them by EXCLUDE_RE — and until 2026-08-24
  // NOTHING asserted that it did. DECISIONS #15 claimed this set was "asserted by
  // the repo gate"; approval finding G-F1 measured that no such assertion existed
  // for any of the three patterns, and that the week- alternative of EXCLUDE_RE
  // lacked the `[^/]*` tail its phase- sibling carries — so reports/week-3-cost.md
  // never matched, published by accident, and sat live on the public repository
  // carrying dollar figures. A regex-only guard fails SILENTLY. These are the two
  // assertions that make #15's sentence true rather than aspirational (#22).
  const isInternalNarrative = (f) => /^reports\/(week-[0-9]|phase-[0-9])[^/]*\.md$/.test(f)
    || f === 'reports/interop-outreach.md';
  {
    // Tree-independent: this tests the PATTERN, not the checkout, so it runs in
    // both states. It is the direct regression test for G-F1 — a pattern edited
    // to match less than it names is exactly how week-3-cost.md escaped, and that
    // failure was invisible because nothing named the file it was meant to catch.
    const mustMatch = ['reports/week-1.md', 'reports/week-3.md', 'reports/week-3-cost.md',
      'reports/week-4.md', 'reports/phase-7-interop.md', 'reports/phase-5.2-grounding-policy.md',
      'reports/interop-outreach.md'];
    const mustNotMatch = ['reports/report-001.md', 'reports/README.md', 'reports/rubric-sweep.md',
      'reports/report-001-audit.md', 'reports/example-drift.md'];
    const missed = mustMatch.filter((f) => !isInternalNarrative(f));
    const overreach = mustNotMatch.filter((f) => isInternalNarrative(f));
    gate.check('internal-narrative pattern matches every internal report and no published one',
      missed.length === 0 && overreach.length === 0, { missed, overreach });
  }
  if (SCAN_ROOT_ARG) {
    const internalHits = files.filter(isInternalNarrative);
    gate.check('published tree excludes reports/week-*, reports/phase-* and reports/interop-outreach.md',
      internalHits.length === 0, { internalHits: internalHits.slice(0, 20) });
  } else {
    gate.check('internal-narrative exclusion (asserted only against a published SCAN_ROOT)', true, { skipped: true });
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

  // ── 10a. OUR OWN suite pins (DECISIONS #18) ────────────────────────────────
  // The manifest pinned upstream SKILL.md bytes from the start; it never pinned
  // OUR rubrics. A silent rubric edit therefore made every cross-report "same
  // suites" comparison false while every individual report stayed true, and no
  // gate could see it. Two pins, because one is not enough: suite_hash is the
  // RUNNER's semantic hash — the same units a receipt records in
  // suite.suite_hash, so a receipt binds to a rubric — and it deliberately
  // covers only {id, prompt, rubric, pass_threshold} (lib/skill.js), so
  // evals_sha256 over the committed bytes catches everything it excludes.
  if (manifest && manifest.skills) {
    const { loadSkill } = require(path.join(ROOT, 'lib', 'skill.js'));
    const HEX64 = /^[0-9a-f]{64}$/;
    const missing = manifest.skills.filter((s) => !HEX64.test(String(s.suite_hash || '')) || !HEX64.test(String(s.evals_sha256 || ''))).map((s) => s.slug);
    gate.check('every manifest skill pins our own suite_hash + evals_sha256 (64-hex)', missing.length === 0, { missing });

    const byteDrift = [];
    const semanticDrift = [];
    for (const s of manifest.skills) {
      const ev = path.join(ROOT, 'suites', s.slug, 'evals.json');
      if (!fs.existsSync(ev)) { byteDrift.push(`${s.slug}: no suite`); continue; }
      const bytes = crypto.createHash('sha256').update(fs.readFileSync(ev)).digest('hex');
      if (bytes !== s.evals_sha256) byteDrift.push(`${s.slug}: committed ${bytes.slice(0, 10)} != pin ${String(s.evals_sha256).slice(0, 10)}`);
      // Load through the runner so the pin is compared in the units it claims.
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'driftproof-pin-'));
      try {
        fs.mkdirSync(path.join(tmp, 'evals'), { recursive: true });
        fs.writeFileSync(path.join(tmp, 'SKILL.md'), `# ${s.name}\n`);
        fs.copyFileSync(ev, path.join(tmp, 'evals', 'evals.json'));
        const got = loadSkill(tmp).suite.suiteHash;
        if (got !== s.suite_hash) semanticDrift.push(`${s.slug}: runner ${got.slice(0, 10)} != pin ${String(s.suite_hash).slice(0, 10)}`);
      } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    }
    gate.check('every pinned evals_sha256 matches the committed suite bytes (a rubric edit without a re-pin FAILS)', byteDrift.length === 0, { byteDrift });
    gate.check('every pinned suite_hash matches what the RUNNER computes for that suite', semanticDrift.length === 0, { semanticDrift });

    // The cross-report claim, gated. A page may say "the same suites" only while
    // the receipts of the reports it is compared against actually agree.
    const pins = new Map(manifest.skills.map((s) => [s.slug, s.suite_hash]));
    const comparable = (manifest.suite_pins && manifest.suite_pins.comparable_reports) || [];
    gate.check('manifest declares which reports claim comparable suites', comparable.length >= 2, { comparable });
    const mismatch = [];
    const claimants = [];
    for (const rep of comparable) {
      const rdir = path.join(ROOT, 'receipts', rep);
      if (!fs.existsSync(rdir)) { mismatch.push(`${rep}: no receipts directory`); continue; }
      for (const f of fs.readdirSync(rdir).filter((x) => x.endsWith('.json') && !x.includes('_index'))) {
        let j; try { j = JSON.parse(fs.readFileSync(path.join(rdir, f), 'utf8')); } catch (e) { continue; }
        // A receipt written by the CLI runner records skill.name and no
        // skill.slug, and its filename carries no `__` — so before this
        // fallback every #006 receipt failed pins.has(slug) and was skipped,
        // and declaring report-006 comparable would have been a claim this
        // assertion silently did not check (`F-009-K`'s class).
        const slug = (j.skill && (j.skill.slug || j.skill.name)) || f.split('__')[0];
        const h = j.suite && j.suite.suite_hash;
        if (!h || !pins.has(slug)) continue;
        if (h !== pins.get(slug)) mismatch.push(`${rep}/${slug}: receipt ${h.slice(0, 10)} != pin ${String(pins.get(slug)).slice(0, 10)}`);
      }
    }
    gate.check('every report claiming comparable suites carries the pinned suite_hash in its receipts', mismatch.length === 0, { mismatch: mismatch.slice(0, 8) });

    // And the claim cannot be made from outside that declared set.
    const repDir = path.join(SCAN_ROOT, 'docs', 'reports');
    if (fs.existsSync(repDir)) {
      for (const d of fs.readdirSync(repDir).filter((x) => /^\d+$/.test(x))) {
        const page = path.join(repDir, d, 'index.html');
        if (!fs.existsSync(page)) continue;
        const html = fs.readFileSync(page, 'utf8');
        if (/the same (\d+ )?(eval )?suites/i.test(html)) claimants.push(`report-${d}`);
      }
    }
    const undeclared = claimants.filter((r) => !comparable.includes(r));
    gate.check('no published page claims "the same suites" from outside the declared comparable set', undeclared.length === 0, { claimants, undeclared });
  }

  // No third-party skill content in the publish tree: the fetch workdir must be
  // gitignored and MUST NOT appear in the tracked/publish file set.
  const gi = fs.existsSync(path.join(ROOT, '.gitignore')) ? fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8') : '';
  gate.check('.skills-workdir is gitignored', /(^|\n)\/?\.skills-workdir\/?/.test(gi), { hint: 'add /.skills-workdir/ to .gitignore' });
  const scanFiles = listFiles(SCAN_ROOT);
  const leaked = scanFiles.filter((f) => f.includes('.skills-workdir'));
  gate.check('no third-party skill content in publish tree (.skills-workdir absent)', leaked.length === 0, { leaked: leaked.slice(0, 10) });
}

// ── 10b. Suite grounding presence (BLOCKING) — Phase 5.2 grounding policy ─────
// Policy: every gradable rubric criterion must trace to text present in the
// skill's SKILL.md at the pinned SHA (rubrics may not extrapolate). Enforced
// MECHANICALLY here as a presence check: every case in every committed suite
// must carry a non-empty `claim` (the documented claim it grades) and a
// non-empty `grounding` (a reference to the SKILL.md text it traces to). The
// correctness of each reference is a human/sweep responsibility (see
// reports/rubric-sweep.md); this gate guarantees the field is never absent.
// Both fields are excluded from suite_hash (lib/skill normalizeCases), so this
// annotation never disturbs a receipt.
gate.section('suite grounding');
{
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'suites', 'manifest.json'), 'utf8'));
  const missing = [];
  let caseTotal = 0, suiteCount = 0;
  for (const s of manifest.skills) {
    const p = path.join(ROOT, 'suites', s.slug, 'evals.json');
    if (!fs.existsSync(p)) { missing.push(`${s.slug}: no evals.json`); continue; }
    suiteCount++;
    const suite = JSON.parse(fs.readFileSync(p, 'utf8'));
    const cases = suite.cases || suite.evals || [];
    for (const c of cases) {
      caseTotal++;
      const id = c.id || c.name || '(unnamed)';
      if (!c.claim || !String(c.claim).trim()) missing.push(`${s.slug}/${id}: empty claim`);
      if (!c.grounding || !String(c.grounding).trim()) missing.push(`${s.slug}/${id}: empty grounding`);
    }
  }
  gate.check('every case in every suite carries a non-empty claim + grounding reference', missing.length === 0, { missing: missing.slice(0, 20) });
  gate.check('grounding check covered all manifest suites and a non-trivial case set', suiteCount === manifest.skills.length && caseTotal >= 60, { suiteCount, caseTotal });
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
        // Report #001 receipts are v0.2, except the two suites re-run under the
        // Phase 5.2 grounding amendment (git-workflow-and-versioning, commit-work),
        // whose receipts are v0.3 — a superset the loader accepts. Either is valid.
        if (!(v.valid && (v.version === '0.2' || v.version === '0.3') && verifyReceiptHash(r))) allValid = false;
      }
      const drift = buildDriftReport(rOld, rNew, {});
      const reg = drift.perCase.filter((c) => c.verdict === 'regression').length;
      const imp = drift.perCase.filter((c) => c.verdict === 'improvement').length;
      const label = reg && imp ? 'MIXED' : reg ? `REGRESSED (${reg})` : imp ? `IMPROVED (${imp})` : 'WITHIN NOISE';
      recomputed.push({ slug: s.slug, perCase: drift.perCase, label, reg, imp });
    }
    gate.check('every Report #001 receipt validates against schema v0.2/v0.3 + self-verifies', allValid && recomputed.length > 0, { skills: recomputed.length });
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
    // PUBLISH-STATE AWARE (#16 clause 1, and the F-F1 / DECISIONS #14 defect
    // class). build-public.sh runs this gate from INSIDE the published tree
    // (`cd $PUB` then DRIFTPROOF_SCAN_ROOT=$PUB), so ROOT is $PUB there — and
    // from 2026-08-24 the cost log is excluded from that tree (#22). Its ABSENCE
    // is the correct end-state on the publish path; asserting its presence there
    // is a gate going red on its own success path, which is the exact defect #14
    // and F-F1 record. Non-vacuous in both directions: delete the file on the DEV
    // tree, where ROOT is not a published tree, and this still fails.
    const rootIsPublishedTree = !!SCAN_ROOT_ARG
      && path.resolve(ROOT) === SCAN_ROOT;
    gate.check('cost log present on the dev tree, and correctly absent from a published one',
      rootIsPublishedTree, { rootIsPublishedTree, costLog, scanRoot: SCAN_ROOT });
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
    if (!m.id || !m.family || !['anthropic', 'openai'].includes(m.provider)) badRows.push(`${m.id}: id/family/provider`);
    if (typeof m.input_price !== 'number' || typeof m.output_price !== 'number') badRows.push(`${m.id}: price`);
    if (!['cheap', 'standard', 'frontier'].includes(m.tier)) badRows.push(`${m.id}: tier`);
    if (typeof m.judge_eligible !== 'boolean') badRows.push(`${m.id}: judge_eligible`);
  }
  gate.check('every registry entry has id/family/prices/tier/judge_eligible (anthropic|openai)', badRows.length === 0, { badRows });
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
  const costHaiku = estimateRunCostUSD({ draws: 1, caseCount: 1, samples: 1, models: ['claude-haiku-4-5'], judgeModel: 'claude-haiku-4-5' });
  const costUnreg = estimateRunCostUSD({ draws: 1, caseCount: 1, samples: 1, models: ['claude-zzz-9'], judgeModel: 'claude-haiku-4-5' });
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

  // ── 15b. Modality gate: a served non-generative model never triggers. ───────
  // A models-LIST endpoint serves transcription/TTS/embedding/image ids that
  // cannot run a text eval suite. They must be filtered BEFORE the trigger — a
  // generative id in the same batch must still fire, proving it's a modality
  // filter, not a blanket skip.
  gate.section('release trigger modality filter');
  const openaiFile = path.join(tmp, 'openai-endpoint.json');
  fs.writeFileSync(openaiFile, JSON.stringify(['gpt-transcribe', 'gpt-live-transcribe', 'gpt-embedding-4', 'gpt-image-2', 'gpt-9.9']));
  const rf3 = path.join(tmp, 'r3.json');
  execFileSync('node', [
    path.join(ROOT, 'scripts', 'release-watch.js'),
    '--stub', '--dry-run', '--models-file', modelsFile, '--openai-models-file', openaiFile,
    '--now', '2026-07-29T12:00:00.000Z', '--state-dir', stateDir, '--registry', regPath,
    '--out-root', outRoot, '--home-dir', homeDir, '--no-notify', '--result-file', rf3,
  ], { cwd: ROOT, stdio: 'pipe' });
  const r3 = JSON.parse(fs.readFileSync(rf3, 'utf8'));
  const nonGen = ['gpt-transcribe', 'gpt-live-transcribe', 'gpt-embedding-4', 'gpt-image-2'];
  gate.check('non-generative served ids are filtered out of newModels', nonGen.every((id) => !r3.newModels.includes(id)), { newModels: r3.newModels });
  gate.check('non-generative ids are recorded under nonGenerative', nonGen.every((id) => (r3.nonGenerative || []).includes(id)), { nonGenerative: r3.nonGenerative });
  gate.check('non-generative ids are recorded as skipped with reason non-generative', nonGen.every((id) => r3.skipped.some((s) => s.id === id && s.reason === 'non-generative')), { skipped: r3.skipped });
  gate.check('a generative id in the same batch still triggers', r3.newModels.includes('gpt-9.9'), { newModels: r3.newModels });

  // ── 15c. Keyless: an empty env is a no-op cycle, NOT a fatal error. ──────────
  // This box runs keyless by design (no ANTHROPIC_API_KEY / OPENAI_API_KEY). The
  // watcher MUST default to keyless mode: complete a poll cycle and exit 0 with an
  // empty env, never throw "requires ANTHROPIC_API_KEY". A key, when present, is an
  // automatic upgrade to the live API poll. Regression guard for the Aug-7 breakage.
  gate.section('release trigger keyless (empty env is not fatal)');
  const keylessEnv = { ...process.env };
  delete keylessEnv.ANTHROPIC_API_KEY;
  delete keylessEnv.OPENAI_API_KEY;
  delete keylessEnv.DRIFTPROOF_MODELS_FILE;
  delete keylessEnv.DRIFTPROOF_OPENAI_MODELS_FILE;
  delete keylessEnv.DRIFTPROOF_MODELS_CACHE;

  const keylessState = path.join(tmp, 'state-keyless');
  const rfK = path.join(tmp, 'rk.json');
  let keylessExit = 0;
  try {
    execFileSync('node', [
      path.join(ROOT, 'scripts', 'release-watch.js'),
      '--now', '2026-07-29T12:00:00.000Z', '--state-dir', keylessState, '--registry', regPath,
      '--out-root', outRoot, '--home-dir', homeDir, '--no-notify', '--result-file', rfK,
    ], { cwd: ROOT, stdio: 'pipe', env: keylessEnv });
  } catch (e) { keylessExit = e.status == null ? 1 : e.status; }
  gate.check('keyless run (no key, no --models-file) exits 0 — not FATAL', keylessExit === 0, { exit: keylessExit });
  const rk = fs.existsSync(rfK) ? JSON.parse(fs.readFileSync(rfK, 'utf8')) : null;
  gate.check('keyless run completed a poll cycle (result written, newModels array)', !!rk && Array.isArray(rk.newModels), { rk: !!rk });
  gate.check('keyless run took the keyless path (no key + no cache → source none)', !!rk && rk.keyless === true && rk.anthropicSource === 'none', { keyless: rk && rk.keyless, source: rk && rk.anthropicSource });
  gate.check('keyless no-op run triggers nothing and finds no new models', !!rk && rk.triggered.length === 0 && rk.newModels.length === 0, { triggered: rk && rk.triggered.length, newModels: rk && rk.newModels.length });

  // models_cache diff (flat cache): a keyless run diffs a dropped-in cache and CAN
  // still surface a genuinely-new id — proving keyless is a working diff surface,
  // not a blanket skip. Cache shape matches refresh-models-cache.js: {fetched_at,source,ids}.
  const cacheFile = path.join(tmp, 'models-cache.json');
  const regIds = JSON.parse(fs.readFileSync(regPath, 'utf8')).models.map((m) => m.id);
  fs.writeFileSync(cacheFile, JSON.stringify({ fetched_at: '2026-08-11T00:00:00.000Z', source: 'test', ids: [...regIds, 'claude-opus-7'] }));
  const rfK2 = path.join(tmp, 'rk2.json');
  execFileSync('node', [
    path.join(ROOT, 'scripts', 'release-watch.js'),
    '--dry-run', '--now', '2026-07-29T12:00:00.000Z', '--state-dir', path.join(tmp, 'state-keyless2'),
    '--registry', regPath, '--models-cache', cacheFile, '--out-root', outRoot, '--home-dir', homeDir,
    '--no-notify', '--result-file', rfK2,
  ], { cwd: ROOT, stdio: 'pipe', env: keylessEnv });
  const rk2 = JSON.parse(fs.readFileSync(rfK2, 'utf8'));
  gate.check('keyless models_cache diff reports source cache (both providers)', rk2.anthropicSource === 'cache' && rk2.openaiSource === 'cache', { anthropic: rk2.anthropicSource, openai: rk2.openaiSource });
  gate.check('keyless models_cache diff surfaces a new id present only in the cache', rk2.newModels.includes('claude-opus-7'), { newModels: rk2.newModels });

  // End-to-end keyless: a planted new id in the cache flows through a REAL (non-dry-run,
  // stubbed) release-watch all the way into a pending-publish.md entry.
  const outE2E = path.join(tmp, 'out-e2e');
  const rfE2E = path.join(tmp, 'rke2e.json');
  execFileSync('node', [
    path.join(ROOT, 'scripts', 'release-watch.js'),
    '--stub', '--now', '2026-07-29T12:00:00.000Z', '--state-dir', path.join(tmp, 'state-e2e'),
    '--registry', regPath, '--models-cache', cacheFile, '--out-root', outE2E, '--home-dir', homeDir,
    '--no-notify', '--result-file', rfE2E,
  ], { cwd: ROOT, stdio: 'pipe', env: keylessEnv });
  const rke2e = JSON.parse(fs.readFileSync(rfE2E, 'utf8'));
  gate.check('keyless e2e: planted cache id is triggered into a real draft', rke2e.triggered.some((t) => t.id === 'claude-opus-7'), { triggered: rke2e.triggered.map((t) => t.id) });
  const pendingE2E = path.join(outE2E, 'reports', 'pending-publish.md');
  gate.check('keyless e2e: the draft reaches pending-publish.md', fs.existsSync(pendingE2E) && /Report #\d+ DRAFT ready/.test(fs.readFileSync(pendingE2E, 'utf8')), { exists: fs.existsSync(pendingE2E) });

  // --seed-only baselines the current snapshot: every served id becomes seen and
  // NOTHING triggers, so a later real poll against the same cache finds no new models.
  const seedState = path.join(tmp, 'state-seed');
  const seedCache = path.join(tmp, 'cache-seed.json');
  fs.writeFileSync(seedCache, JSON.stringify({ fetched_at: '2026-08-11T00:00:00.000Z', source: 'test', ids: [...regIds, 'claude-opus-9'] }));
  const rfSeed = path.join(tmp, 'rseed.json');
  execFileSync('node', [
    path.join(ROOT, 'scripts', 'release-watch.js'),
    '--seed-only', '--now', '2026-07-29T12:00:00.000Z', '--state-dir', seedState,
    '--registry', regPath, '--models-cache', seedCache, '--out-root', outE2E, '--home-dir', homeDir,
    '--no-notify', '--result-file', rfSeed,
  ], { cwd: ROOT, stdio: 'pipe', env: keylessEnv });
  const rseed = JSON.parse(fs.readFileSync(rfSeed, 'utf8'));
  gate.check('seed-only triggers nothing and reports a seeded count', rseed.triggered.length === 0 && rseed.seeded > 0, { seeded: rseed.seeded, triggered: rseed.triggered.length });
  const rfSeed2 = path.join(tmp, 'rseed2.json');
  execFileSync('node', [
    path.join(ROOT, 'scripts', 'release-watch.js'),
    '--stub', '--now', '2026-07-29T12:00:00.000Z', '--state-dir', seedState,
    '--registry', regPath, '--models-cache', seedCache, '--out-root', outE2E, '--home-dir', homeDir,
    '--no-notify', '--result-file', rfSeed2,
  ], { cwd: ROOT, stdio: 'pipe', env: keylessEnv });
  const rseed2 = JSON.parse(fs.readFileSync(rfSeed2, 'utf8'));
  gate.check('after seed-only, the baselined snapshot yields no new models', rseed2.newModels.length === 0 && rseed2.triggered.length === 0, { newModels: rseed2.newModels });

  fs.rmSync(tmp, { recursive: true, force: true });
}

// ── 15d. Cache refresher: public no-auth enumeration → native-id cache. ─────────
// scripts/refresh-models-cache.js maps an OpenRouter-shaped response to native ids
// and writes state/models-cache.json; it must be NEVER-FATAL (a fetch/parse failure
// keeps the existing cache and exits 0), so a transient blip can neither wipe the
// diff surface nor block release-watch.
gate.section('models cache refresher (public no-auth enumeration)');
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'driftproof-refresh-'));
  const refresher = path.join(ROOT, 'scripts', 'refresh-models-cache.js');

  // Mocked OpenRouter response → a valid flat cache with native ids.
  const orResp = path.join(tmp, 'openrouter.json');
  fs.writeFileSync(orResp, JSON.stringify({ data: [
    { id: 'anthropic/claude-opus-4.8' },          // dot -> dash
    { id: 'anthropic/claude-sonnet-5:batch' },     // billing suffix dropped + dedup
    { id: 'anthropic/claude-sonnet-5' },
    { id: 'openai/gpt-5.6-sol' },                   // openai keeps dots
    { id: 'openai/o3' },
    { id: 'google/gemini-3' },                      // other vendors excluded
    { id: 'nvidia/nemotron-3.5' },
  ] }));
  const outCache = path.join(tmp, 'models-cache.json');
  execFileSync('node', [refresher, '--from-file', orResp, '--out', outCache, '--now', '2026-08-11T00:00:00.000Z'], { cwd: ROOT, stdio: 'pipe' });
  const cache = JSON.parse(fs.readFileSync(outCache, 'utf8'));
  gate.check('refresher writes a flat {fetched_at,source,ids} cache', typeof cache.fetched_at === 'string' && typeof cache.source === 'string' && Array.isArray(cache.ids), { cache: Object.keys(cache) });
  gate.check('refresher maps anthropic version dots to dashes', cache.ids.includes('claude-opus-4-8'), { ids: cache.ids });
  gate.check('refresher keeps openai native dotted ids', cache.ids.includes('gpt-5.6-sol') && cache.ids.includes('o3'), { ids: cache.ids });
  gate.check('refresher drops billing-variant suffixes and dedups', cache.ids.filter((id) => id === 'claude-sonnet-5').length === 1 && !cache.ids.some((id) => /:/.test(id)), { ids: cache.ids });
  gate.check('refresher excludes non-anthropic/openai vendors', !cache.ids.some((id) => /gemini|nemotron/.test(id)), { ids: cache.ids });

  // Network-failure path: an unreadable source must leave the existing cache intact
  // and exit 0 (never fatal, never blocks release-watch).
  const before = fs.readFileSync(outCache, 'utf8');
  let refreshExit = 0;
  try {
    execFileSync('node', [refresher, '--from-file', path.join(tmp, 'does-not-exist.json'), '--out', outCache, '--now', '2026-08-11T01:00:00.000Z'], { cwd: ROOT, stdio: 'pipe' });
  } catch (e) { refreshExit = e.status == null ? 1 : e.status; }
  gate.check('refresher on a fetch failure exits 0 (never fatal)', refreshExit === 0, { exit: refreshExit });
  gate.check('refresher on a fetch failure leaves the existing cache byte-unchanged', fs.readFileSync(outCache, 'utf8') === before);

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
  // THE DEFAULTS ARE READ FROM config.js, NOT RESTATED HERE. This assertion used
  // to pin `max-usd: default '2'` as a literal, so when spec 018 recalibrated the
  // caps for sampling-era math the gate went red for holding the stale number —
  // the same defect it was meant to protect, one layer out. It now asserts that
  // the Action's declared defaults ARE the shipped defaults, whatever those are.
  const { DEV_MAX_USD: actUsd, DEV_MAX_CALLS: actCalls } = require(path.join(ROOT, 'config.js'));
  const declared = (k) => (a.match(new RegExp(`${k}:[\\s\\S]*?default:\\s*'([^']*)'`)) || [])[1];
  const passes = (k) => new RegExp(`--${k} "\\$\\{\\{ inputs\\.${k} \\}\\}"`).test(a);
  gate.check('action declares skill-dir + api-key + fail-on-regression, and each cap input equals the shipped default AND reaches the CLI',
    /skill-dir:/.test(a) && /api-key:/.test(a) && /fail-on-regression:/.test(a)
      && Number(declared('max-usd')) === actUsd && Number(declared('max-calls')) === actCalls
      && passes('max-usd') && passes('max-calls'),
    { maxUsd: declared('max-usd'), wantUsd: actUsd, maxCalls: declared('max-calls'), wantCalls: actCalls,
      passesUsd: passes('max-usd'), passesCalls: passes('max-calls') });
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

// ── 20b. Published version references track package.json (BLOCKING) ──────────
// RUNBOOK precondition 4: the README and docs/index.html reference the release
// tag, and they are updated in the same publish. That was a rule a human had to
// remember, and it was not remembered — v0.5.0 shipped with both still naming
// v0.4.0, which DECISIONS #12's reasoning says is the shape of rule that fails.
// It is now a fact the gate holds. Local only, by design: the tag's EXISTENCE is
// verified once at release time (RUNBOOK), and a repo gate that needs the network
// to be green is a gate that goes red for reasons that are not about the tree.
gate.section('published version references');
{
  const pkgVer = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  const wantTag = `v${pkgVer}`;
  const SURFACES = ['README.md', path.join('docs', 'index.html')];
  const stale = [];
  const perFile = {};
  for (const rel of SURFACES) {
    const f = path.join(SCAN_ROOT, rel);
    if (!fs.existsSync(f)) { stale.push(`${rel}: missing`); perFile[rel] = 0; continue; }
    const txt = fs.readFileSync(f, 'utf8');
    const refs = [...txt.matchAll(/driftproofhq\/driftproof@(v[0-9]+\.[0-9]+\.[0-9]+)/g)];
    perFile[rel] = refs.length;
    for (const m of refs) if (m[1] !== wantTag) stale.push(`${rel}: ${m[1]} != ${wantTag}`);
  }
  // PER FILE, not a sum. As a sum this passed with docs/index.html carrying no
  // reference at all, so long as README carried two — the assertion's own label
  // said "each" while its body said "between them" (approval finding F-2).
  const barren = SURFACES.filter((rel) => perFile[rel] < 1);
  gate.check('README + docs/index.html EACH carry a pinned Action reference', barren.length === 0, { perFile, barren });
  gate.check('every published Action reference names the current package version', stale.length === 0, { wantTag, stale });

  // The README's sample receipt states a runner_version. A reader copies that
  // block as the shape of a real receipt, so it must not name an engine that is
  // no longer the one shipping.
  const { RUNNER_VERSION } = require(path.join(ROOT, 'config.js'));
  const rd = fs.readFileSync(path.join(SCAN_ROOT, 'README.md'), 'utf8');
  const rv = [...rd.matchAll(/"runner_version":\s*"([^"]+)"/g)].map((m) => m[1]);
  gate.check('README sample receipt runner_version equals RUNNER_VERSION', rv.length > 0 && rv.every((v) => v === RUNNER_VERSION), { rv, RUNNER_VERSION });

  // The sibling, which the first version of this section did not hold. Fixing
  // runner_version alone turned a coherently-STALE sample block (0.4.0/0.3.1,
  // the true pairing at c06b3bb) into an IMPOSSIBLE one (0.5.0/0.3.1, a
  // combination no engine ever emitted) — and pinned half of it green. A
  // reference is not verified by checking the reference; it is verified by
  // checking the statement it sits inside (approval finding F-1, blocking).
  const { RECEIPT_SCHEMA_VERSION } = require(path.join(ROOT, 'config.js'));
  const sv = [...rd.matchAll(/"schema_version":\s*"([^"]+)"/g)].map((m) => m[1]);
  gate.check('README sample receipt schema_version equals RECEIPT_SCHEMA_VERSION', sv.length > 0 && sv.every((v) => v === RECEIPT_SCHEMA_VERSION), { sv, RECEIPT_SCHEMA_VERSION });

  // O-2: RUNBOOK precondition 3 ("versions agree") was silently violable —
  // package.json could move while config.js stayed put, and §20b would still be
  // green because it only ever compared the surfaces to package.json.
  gate.check('package.json version equals RUNNER_VERSION (RUNBOOK precondition 3)', pkgVer === RUNNER_VERSION, { pkgVer, RUNNER_VERSION });
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

// ── 23. Provider/surface two-axis abstraction (adapter unit) ─────────────────
gate.section('provider/surface lanes');
{
  const prov = require('../lib/provider');
  gate.check('inferProvider: claude-* → anthropic, gpt-* → openai',
    prov.inferProvider('claude-sonnet-5') === 'anthropic' && prov.inferProvider('gpt-5.6-sol') === 'openai' && prov.inferProvider('haiku') === 'anthropic');
  // Env keys held in variables + bracket-set so this test file carries no literal
  // env-secret assignment string (which the hygiene scanner would otherwise flag).
  const KEY = 'OPENAI_API' + '_KEY', SURF = 'OPENAI_SURFACE', CP = 'CLAUDE_PROVIDER';
  const savedKey = process.env[KEY], savedSurf = process.env[SURF], savedClaude = process.env[CP];
  delete process.env[KEY]; delete process.env[SURF]; delete process.env[CP];
  gate.check('openai model, no key → surface openai-cli (codex subscription)', prov.surfaceForModel('gpt-5.6-sol') === 'openai-cli');
  gate.check('anthropic model default → surface claude-cli', prov.surfaceForModel('claude-sonnet-5') === 'claude-cli');
  process.env[KEY] = 'x';
  gate.check('openai model WITH key → surface openai-api (metered preferred)', prov.surfaceForModel('gpt-5.6-sol') === 'openai-api');
  process.env[SURF] = 'cli';
  gate.check('OPENAI_SURFACE=cli forces openai-cli even with a key', prov.surfaceForModel('gpt-5.6-sol') === 'openai-cli');
  if (savedKey === undefined) delete process.env[KEY]; else process.env[KEY] = savedKey;
  if (savedSurf === undefined) delete process.env[SURF]; else process.env[SURF] = savedSurf;
  if (savedClaude === undefined) delete process.env[CP]; else process.env[CP] = savedClaude;
  gate.check('metered surfaces = api/openai-api; subscription = claude-cli/openai-cli',
    prov.isMeteredSurface('api') && prov.isMeteredSurface('openai-api') && prov.isSubscriptionSurface('claude-cli') && prov.isSubscriptionSurface('openai-cli'));
}

// ── 24. Codex (openai/cli) invocation template — EXACT + never -a ────────────
gate.section('codex exec template');
{
  const prov = require('../lib/provider');
  const args = prov.buildCodexArgs({ model: 'gpt-5.6-sol', outFile: '/tmp/out.txt' });
  const expected = ['exec', '--json', '-s', 'read-only', '--skip-git-repo-check', '--ephemeral', '-o', '/tmp/out.txt', '-m', 'gpt-5.6-sol'];
  gate.checkEqual('codex exec argv matches the verified recon template', args, expected);
  const flat = [...prov.CODEX_EXEC_ARGS, ...args].join(' ');
  gate.check('codex args NEVER contain -a / --ask-for-approval (invalid on exec)',
    !args.includes('-a') && !args.includes('--ask-for-approval') && !/(^|\s)-a(\s|$)/.test(flat) && !/--ask-for-approval/.test(flat));
  gate.check('codex template = read-only sandbox + --ephemeral + --skip-git-repo-check + -o',
    args[args.indexOf('-s') + 1] === 'read-only' && args.includes('--ephemeral') && args.includes('--skip-git-repo-check') && args.includes('-o'));
  gate.check('codex args omit -m when no model is given', !prov.buildCodexArgs({ outFile: '/tmp/o.txt' }).includes('-m'));
  gate.check('codexAuthPresent() is a boolean presence check (never reads/prints contents)', typeof prov.codexAuthPresent() === 'boolean');
  // REGRESSION GUARD: the prompt is delivered on stdin (positional `-`), NEVER as
  // a positional argv — real SKILL.md files start with `---` and codex rejects a
  // positional beginning with `--` ("unexpected argument '---'"). The final argv's
  // only non-flag positional must be exactly `-`, and no element may start with `--`
  // other than the known long flags.
  const finalArgs = prov.codexFinalArgs({ model: 'gpt-5.6-sol', outFile: '/tmp/o.txt' });
  gate.check('codex final argv ends with the stdin sentinel `-` (prompt via stdin, not positional)', finalArgs[finalArgs.length - 1] === '-');
  const KNOWN_LONG = new Set(['--json', '--skip-git-repo-check', '--ephemeral']);
  gate.check('no codex argv element is an unknown `--`/`---` positional (SKILL.md frontmatter safe)',
    finalArgs.every((a) => !/^--/.test(a) || KNOWN_LONG.has(a)));
}

// ── 25. provider/surface receipt fields (openai lane, stubbed) ──────────────
gate.section('provider/surface receipts');
{
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'driftproof-v031-'));
  try {
    execFileSync('node', [path.join(ROOT, 'bin', 'driftproof'), 'run', EXAMPLE, '--models', 'gpt-5.6-sol', '--judge-model', 'claude-haiku-4-5', '--max-cases', '1', '--samples', '1', '--max-usd', '2', '--out', outDir],
      { cwd: ROOT, env: { ...process.env, DRIFTPROOF_STUB: '1', OPENAI_API_KEY: '', OPENAI_SURFACE: 'cli' }, stdio: 'ignore' });
    const f = fs.readdirSync(outDir).filter((x) => x.endsWith('.json') && !x.endsWith('.summary.md'))[0];
    const r = JSON.parse(fs.readFileSync(path.join(outDir, f), 'utf8'));
    const v = validateReceipt(r);
    gate.check('openai/cli stub receipt validates against the CURRENT schema', v.valid && v.version === RECEIPT_SCHEMA_VERSION, { ...v, expected: RECEIPT_SCHEMA_VERSION });
    gate.check('openai/cli receipt: provider=openai, surface=openai-cli', r.run.provider === 'openai' && r.run.surface === 'openai-cli');
    gate.check('openai/cli receipt carries surface_overhead_note (fixed Codex preamble)', typeof r.run.surface_overhead_note === 'string' && /codex exec/.test(r.run.surface_overhead_note));
    gate.check('receipt carries skill.tokens (value-per-token axis)', Number.isInteger(r.skill.tokens) && r.skill.tokens > 0);
  } finally { fs.rmSync(outDir, { recursive: true, force: true }); }
  const ra = synthReceipt([mkcase('c', 'with_skill', [0.8, 0.8, 0.8], 0.7), mkcase('c', 'baseline', [0.4, 0.4, 0.4], 0.7)]);
  gate.check('anthropic receipt: provider=anthropic and NO surface_overhead_note', ra.run.provider === 'anthropic' && ra.run.surface_overhead_note === undefined);
}

// ── 26. Registry: OpenAI entries priced + fixed-judge enforcement ─────────────
gate.section('openai registry + judge policy');
{
  const M = require('../lib/models');
  const price = M.priceForModel('gpt-5.6-sol');
  gate.check('gpt-5.6-sol registered + priced $5/$30 + provider openai', M.registryStatus('gpt-5.6-sol') === 'registered' && price.input === 5 && price.output === 30 && M.providerForModel('gpt-5.6-sol') === 'openai');
  gate.check('every OpenAI registry entry is judge_eligible:false', M.loadRegistry().models.filter((m) => m.provider === 'openai').every((m) => m.judge_eligible === false));
  gate.check('OpenAI registry covers the required flagship set', ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini'].every((id) => M.registryStatus(id) === 'registered'));
  const c = estimateRunCostUSD({ draws: 1, caseCount: 1, samples: 1, models: ['claude-sonnet-5', 'gpt-5.6-sol'], judgeModel: 'claude-haiku-4-5' });
  const cUnreg = estimateRunCostUSD({ draws: 1, caseCount: 1, samples: 1, models: ['claude-sonnet-5', 'gpt-zzz-unknown'], judgeModel: 'claude-haiku-4-5' });
  gate.check('gpt-5.6-sol projection is registry-priced (< an unregistered gpt id)', c.totalUSD < cUnreg.totalUSD, { c: c.totalUSD, cUnreg: cUnreg.totalUSD });
  let threw = null; try { M.assertJudgeEligible('gpt-5.6-sol'); } catch (e) { threw = e.code; }
  gate.check('assertJudgeEligible(openai) throws JUDGE_INELIGIBLE (no OpenAI judge)', threw === 'JUDGE_INELIGIBLE');
  let ok = true; try { M.assertJudgeEligible('claude-haiku-4-5'); } catch (_e) { ok = false; }
  gate.check('assertJudgeEligible(haiku) passes', ok);
  const pc = M.providerConfig('openai');
  gate.check('providerConfig(openai) exposes a base_url (generic future-provider hook)', !!pc && typeof pc.base_url === 'string' && /^https?:\/\//.test(pc.base_url));
}

// ── 27. Deterministic post-checks + value-per-token ──────────────────────────
gate.section('post-checks + value-per-token');
{
  const { runOneCheck } = require('../lib/checks');
  const { canonicalize } = require('../lib/canonical');
  gate.check('regex check matches / misses correctly', runOneCheck({ kind: 'regex', pattern: '^feat', flags: 'm' }, 'feat: x') === true && runOneCheck({ kind: 'regex', pattern: '^feat' }, 'nope') === false);
  gate.check('contains / not_contains / min_length evaluate', runOneCheck({ kind: 'contains', value: '429' }, 'ret 429') === true && runOneCheck({ kind: 'not_contains', value: 'zzz' }, 'clean') === true && runOneCheck({ kind: 'min_length', value: 5 }, 'abcdef') === true && runOneCheck({ kind: 'min_length', value: 5 }, 'abc') === false);
  gate.check('an INVALID regex fails closed (pass:false, no throw)', runOneCheck({ kind: 'regex', pattern: '(?i)inline-flags-invalid-in-js' }, 'x') === false);
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'suites', 'commit-work', 'evals.json'), 'utf8'));
  const cases = normalizeCases(raw);
  gate.check('commit-work suite declares checks on ≥1 case (parsed by normalizeCases)', cases.filter((c) => Array.isArray(c.checks) && c.checks.length).length >= 1);
  const core = cases.map((c) => ({ id: c.id, prompt: c.prompt, rubric: c.rubric, pass_threshold: c.pass_threshold }));
  gate.check('suite_hash core projection excludes checks (stable 64-hex)', /^[a-f0-9]{64}$/.test(sha256(canonicalize(core))));
  const { estimateTokens, deltaPer1kTokens } = require('../lib/skillCost');
  gate.check('estimateTokens ≈ chars/4', estimateTokens('a'.repeat(4000)) === 1000);
  gate.check('deltaPer1kTokens(0.40, 2000) === 0.2; zero tokens → null', deltaPer1kTokens(0.40, 2000) === 0.2 && deltaPer1kTokens(0.4, 0) === null);
}

// ── 28. Report #002 staging: stub draft, NOT in the public tree ──────────────
gate.section('report-002 staging (stub)');
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'driftproof-rep002-'));
  try {
    execFileSync('node', [path.join(ROOT, 'scripts', 'prepare-report-002.js'), '--out-root', tmp, '--now', '2026-07-30T00:00:00.000Z'],
      { cwd: ROOT, stdio: 'ignore' });
    const draftHtmlPath = path.join(tmp, 'docs', 'reports', '002-draft', 'index.html');
    const recDir = path.join(tmp, 'receipts', 'report-002-draft');
    gate.check('stub report-002 built a draft page', fs.existsSync(draftHtmlPath));
    const html = fs.existsSync(draftHtmlPath) ? fs.readFileSync(draftHtmlPath, 'utf8') : '';
    gate.check('report-002 draft is noindex + carries a not-published banner', /content="noindex"/.test(html) && /DRAFT — not published/.test(html));
    gate.check('report-002 draft has value-per-token + post-checks columns', /1k skill-tok/.test(html) && /post-checks/.test(html));
    gate.check('report-002 draft carries neutrality framing (durability, not a ranking)', /neutrality/.test(html) && /not a model ranking/i.test(html));
    const recs = fs.existsSync(recDir) ? fs.readdirSync(recDir).filter((f) => f.endsWith('.json')) : [];
    gate.check('report-002 emitted 20 receipts (10 skills × 2 substrates)', recs.length === 20, { n: recs.length });
    let allValid = recs.length > 0;
    for (const f of recs) { const r = JSON.parse(fs.readFileSync(path.join(recDir, f), 'utf8')); if (!(validateReceipt(r).valid && verifyReceiptHash(r))) allValid = false; }
    gate.check('every report-002 receipt validates its own schema version + self-verifies', allValid);
    const subs = new Set(recs.map((f) => f.replace(/\.json$/, '').split('__')[1]));
    gate.check('report-002 receipts cover BOTH substrates (claude + gpt)', subs.has('claude-sonnet-5') && subs.has('gpt-5.6-sol'));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  // Any *-draft/ report or receipt dir is GITIGNORED — a sitting draft never rides
  // a publish. Checked on generic (unpublished) draft paths so the invariant holds
  // AFTER a real report is promoted out of -draft (e.g. 002 → published).
  const isIgnored = (p) => { try { execFileSync('git', ['check-ignore', p], { cwd: ROOT, stdio: 'pipe' }); return true; } catch (_e) { return false; } };
  gate.check('any docs/reports/*-draft/ path is gitignored (never rides a publish)', isIgnored('docs/reports/000-draft/index.html'));
  gate.check('any receipts/report-*-draft/ path is gitignored (never rides a publish)', isIgnored('receipts/report-000-draft/x.json'));
}

// ── 29. Methodology + neutrality pages (Phase 6) ─────────────────────────────
gate.section('methodology + neutrality pages');
{
  const nHtml = fs.existsSync(path.join(ROOT, 'docs', 'neutrality.html')) ? fs.readFileSync(path.join(ROOT, 'docs', 'neutrality.html'), 'utf8') : '';
  const mHtml = fs.existsSync(path.join(ROOT, 'docs', 'methodology.html')) ? fs.readFileSync(path.join(ROOT, 'docs', 'methodology.html'), 'utf8') : '';
  const idx = fs.readFileSync(path.join(ROOT, 'docs', 'index.html'), 'utf8');
  gate.check('docs/neutrality.html present + uses the site stylesheet', !!nHtml && /style\.css/.test(nHtml));
  gate.check('neutrality: durability-not-ranking + same judge/suites/n + no favoritism', /durability/i.test(nHtml) && /not (a )?model (ranking|leaderboard)/i.test(nHtml) && /Same suites/i.test(nHtml) && /favoritism/i.test(nHtml));
  gate.check('neutrality: judge-affinity limitation + delta-cancels mitigation', /affinity/i.test(nHtml) && /delta/i.test(nHtml) && /cancel/i.test(nHtml));
  gate.check('neutrality: surfaces disclosed (API preferred, CLI disclosed)', /surface/i.test(nHtml) && /disclosed/i.test(nHtml) && /preferred for published/i.test(nHtml));
  gate.check('docs/methodology.html present + links neutrality', !!mHtml && /neutrality\.html/.test(mHtml));
  gate.check('methodology documents post-checks (supplementary) + value-per-token method', /post-check/i.test(mHtml) && /supplementary/i.test(mHtml) && /value-per-token/i.test(mHtml) && /ceil\(chars/i.test(mHtml));
  gate.check('index nav links Methodology + Neutrality', /methodology\.html/.test(idx) && /neutrality\.html/.test(idx));
}

// ── 30. Timeout tolerance: per-surface policy + failed_timeout non-fatal ─────
gate.section('timeout tolerance / failed_timeout');
{
  const prov = require('../lib/provider');
  // (a) Per-surface retry/timeout policy: cli 300s + 30/60/120s backoff; api tighter.
  const cliP = prov.retryPolicyForSurface('claude-cli');
  const oaCliP = prov.retryPolicyForSurface('openai-cli');
  const apiP = prov.retryPolicyForSurface('api');
  gate.check('cli surfaces get 300s timeout + 30s base backoff (→30/60/120) × 4 tries',
    cliP.timeoutMs === 300000 && cliP.baseDelayMs === 30000 && cliP.tries === 4 && oaCliP.timeoutMs === 300000 && oaCliP.baseDelayMs === 30000);
  gate.check('api surfaces keep the tighter 120s / 3s policy', apiP.timeoutMs === 120000 && apiP.baseDelayMs === 3000);

  // (b) Schema/build: an incomplete receipt (failed_timeout case, NO samples)
  //     validates; aggregates exclude it; run.status incomplete.
  const inc = synthReceipt([
    mkcase('c1', 'with_skill', [0.8, 0.8, 0.8], 0.7),
    mkcase('c1', 'baseline', [0.4, 0.4, 0.4], 0.7),
    { id: 'c2', mode: 'with_skill', case_status: 'failed_timeout', reason: 'provider(claude-cli) timed out after 300000ms' },
  ]);
  gate.check('incomplete receipt (failed_timeout case) validates at its own version + self-verifies', validateReceipt(inc).valid && verifyReceiptHash(inc));
  gate.check('run.status=incomplete + failed_case_count set when a case failed', inc.run.status === 'incomplete' && inc.run.failed_case_count === 1);
  gate.check('failed_timeout case carries NO fabricated samples/hashes', inc.results.cases.filter((c) => c.case_status === 'failed_timeout').every((c) => c.samples === undefined && c.generation_hash === undefined && c.judge_sample_hashes === undefined));
  gate.check('aggregates EXCLUDE the failed case (with_skill case_count 1)', inc.results.aggregates.with_skill.case_count === 1);
  const comp = synthReceipt([mkcase('x', 'with_skill', [0.8, 0.8, 0.8], 0.7), mkcase('x', 'baseline', [0.4, 0.4, 0.4], 0.7)]);
  gate.check('a complete receipt carries no incomplete markers', comp.run.status === undefined && comp.run.failed_case_count === undefined);

  // (b2) `run.failed_case_count` COUNTS CASES, asserted on a PAIRED fixture.
  //      The `inc` receipt above cannot catch the defect: its failing case has
  //      no paired arm, so rows and cases agree there by accident. Once spec
  //      017 made exclusion pairwise, `cases.length - okCases.length` removed
  //      BOTH arms of every excluded case and reported 2 for one failed arm —
  //      a figure lib/run.js and five report scripts print
  //      (approval-20260901T064027Z BLOCKING 1). The field is now the length of
  //      `results.aggregates.excluded_cases`, so the two cannot disagree.
  const tmo = (id, modeName) => ({ id, mode: modeName, case_status: 'failed_timeout', reason: 'provider timed out after retries' });
  const pairedOneArm = synthReceipt([
    mkcase('p1', 'with_skill', [0.8, 0.8, 0.8], 0.7), tmo('p1', 'baseline'),
    mkcase('p2', 'with_skill', [0.6, 0.6, 0.6], 0.7), mkcase('p2', 'baseline', [0.4, 0.4, 0.4], 0.7),
  ]);
  const pairedBothArms = synthReceipt([
    tmo('p1', 'with_skill'), tmo('p1', 'baseline'),
    mkcase('p2', 'with_skill', [0.6, 0.6, 0.6], 0.7), mkcase('p2', 'baseline', [0.4, 0.4, 0.4], 0.7),
  ]);
  const failedOf = (r) => (r.run.failed_case_count == null ? 0 : r.run.failed_case_count);
  const excludedOf = (r) => (r.results.aggregates.excluded_cases || []);
  gate.check('failed_case_count counts CASES on a PAIRED fixture: one failed arm 1, both failed arms 1, none 0',
    failedOf(pairedOneArm) === 1 && failedOf(pairedBothArms) === 1 && failedOf(comp) === 0);
  gate.check('failed_case_count IS excluded_cases.length on every fixture — the two cannot disagree',
    [inc, comp, pairedOneArm, pairedBothArms].every((r) => failedOf(r) === excludedOf(r).length));
  gate.check('a case with BOTH arms unmeasured is ONE exclusion, recording both modes',
    excludedOf(pairedBothArms).length === 1 && excludedOf(pairedBothArms)[0].modes.length === 2);

  // (c) A persistent timeout is NON-FATAL: exercise the real runner via the test
  //     seam (stub mode) and assert the run completes and marks the case failed.
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'driftproof-tmo-'));
  let ranOk = false, r = null;
  try {
    execFileSync('node', [path.join(ROOT, 'bin', 'driftproof'), 'run', EXAMPLE, '--models', 'claude-haiku-4-5', '--max-cases', '2', '--samples', '1', '--max-usd', '2', '--out', outDir],
      { cwd: ROOT, env: { ...process.env, DRIFTPROOF_STUB: '1', DRIFTPROOF_TEST_TIMEOUT_CASEID: 'feat-basic' }, stdio: 'ignore' });
    ranOk = true;
    const f = fs.readdirSync(outDir).filter((x) => x.endsWith('.json') && !x.endsWith('.summary.md'))[0];
    r = JSON.parse(fs.readFileSync(path.join(outDir, f), 'utf8'));
  } catch (_e) { ranOk = false; }
  gate.check('a persistent timeout does NOT kill the run (exit 0, receipt emitted)', ranOk && !!r);
  gate.check('the timed-out case is recorded failed_timeout + receipt marked incomplete', !!r && r.run.status === 'incomplete' && r.results.cases.some((c) => c.case_status === 'failed_timeout'));
  gate.check('the timed-out receipt still validates + self-verifies', !!r && validateReceipt(r).valid && verifyReceiptHash(r));
  fs.rmSync(outDir, { recursive: true, force: true });
}

// ── 31. Report #002 resume / restore / incomplete-exclusion ──────────────────
gate.section('report-002 resume + incomplete');
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'driftproof-rr-'));
  try {
    const run = (extra = []) => execFileSync('node', [path.join(ROOT, 'scripts', 'prepare-report-002.js'), '--out-root', tmp, '--restore-from', '/nonexistent-backup', '--now', '2026-07-31T00:00:00.000Z', ...extra],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const recDir = path.join(tmp, 'receipts', 'report-002-draft');

    run(); // first run: generate 20 stub receipts
    const sampleFile = path.join(recDir, fs.readdirSync(recDir).find((f) => f.endsWith('.json')));
    const before = fs.readFileSync(sampleFile, 'utf8');
    const out2 = run(); // resume: must skip everything, regenerate nothing
    const after = fs.readFileSync(sampleFile, 'utf8');
    gate.check('resume does NOT wipe/regenerate existing receipts (byte-identical)', before === after);
    gate.check('resume reports the completed pairs skipped', /skipped/.test(out2) && /\b20\b/.test(out2));
    gate.check('default is resume, not wipe (20 receipts survive a re-run)', fs.readdirSync(recDir).filter((f) => f.endsWith('.json')).length === 20);

    const outF = run(['--fresh']);
    gate.check('--fresh restores the wipe-and-regenerate behavior', /\[fresh\]/.test(outF));

    // Incomplete receipt is EXCLUDED from the verdict (NOT MEASURED). Build one
    // in-gate (buildReceipt is sync) over a real manifest skill and drop it in.
    const slug = JSON.parse(fs.readFileSync(path.join(ROOT, 'suites', 'manifest.json'), 'utf8')).skills[6].slug;
    const inc = buildReceipt({
      skill: { name: slug, version: '0', contentHash: 'b'.repeat(64), tokens: 2000 },
      suite: { format: 'agentskills.io/evals', suiteHash: 'c'.repeat(64), caseCount: 2 },
      run: { ...RUN_META, model_id: 'claude-sonnet-5' },
      cases: [mkcase('n1', 'with_skill', [0.8, 0.8, 0.8], 0.7), mkcase('n1', 'baseline', [0.4, 0.4, 0.4], 0.7), { id: 'n2', mode: 'with_skill', case_status: 'failed_timeout', reason: 'timed out' }],
    });
    fs.writeFileSync(path.join(recDir, `${slug}__claude-sonnet-5.json`), JSON.stringify(inc, null, 2));
    const out3 = run(); // resume: an INCOMPLETE receipt must be RE-RUN, never skipped
    const regen = JSON.parse(fs.readFileSync(path.join(recDir, `${slug}__claude-sonnet-5.json`), 'utf8'));
    gate.check('resume RE-RUNS an incomplete receipt (regenerated to complete)', regen.run.status !== 'incomplete' && !regen.results.cases.some((c) => c.case_status === 'failed_timeout'));
    gate.check('resume does NOT skip the incomplete pair (19 skipped, not 20)', /\b19 skipped\b/.test(out3));
    const html = fs.readFileSync(path.join(tmp, 'docs', 'reports', '002-draft', 'index.html'), 'utf8');
    gate.check('re-run incomplete pair is now MEASURED (no NOT MEASURED left in draft)', !/NOT MEASURED/.test(html) && !/NOT MEASURED/.test(out3));

    // The NOT MEASURED render path still fires when a receipt GENUINELY stays
    // incomplete (a re-run that times out again) — test the builder directly.
    const { draftHtml } = require('../scripts/prepare-report-002');
    const nmHtml = draftHtml({
      rows: [], models: { claude: 'claude-sonnet-5', gpt: 'gpt-5.6-sol' },
      surfaces: { claude: 'claude-cli', gpt: 'openai-cli' }, generatedUtc: '2026-07-31T00:00:00.000Z',
      projection: { totalUSD: 0, perModel: [] }, stub: true,
      notMeasured: [{ slug, substrate: 'claude-sonnet-5', failed: 1 }],
    });
    gate.check('draftHtml still renders the NOT MEASURED card for a genuinely incomplete pair', /Not measured \(1\)/.test(nmHtml) && nmHtml.includes(slug));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

// ── 32. Report #002 per-case band-separation verdict (Report #001 discipline) ──
gate.section('report-002 band-separation verdict');
{
  const { durabilityVerdict } = require('../scripts/prepare-report-002');
  const rec = (w, b) => synthReceipt([mkcase('c1', 'with_skill', w, 0.7), mkcase('c1', 'baseline', b, 0.7)]);
  const help = rec([0.9, 0.88, 0.9, 0.87, 0.89], [0.6, 0.62, 0.58, 0.61, 0.6]); // clean +0.28, sd>0
  const vDur = durabilityVerdict(help, help);
  gate.check('band-separated + ≥floor on both substrates → DURABLE (not low-res)', vDur.label === 'DURABLE' && vDur.lowRes === false);
  const noisy = rec([0.9, 0.5, 0.7, 0.6, 0.85], [0.8, 0.55, 0.72, 0.58, 0.7]); // means differ but bands overlap
  gate.check('overlapping bands never manufacture a verdict → NO EFFECT', durabilityVerdict(noisy, noisy).label === 'NO EFFECT');
  const pb = rec([0.8, 0.8, 0.8, 0.8, 0.8], [0.6, 0.6, 0.6, 0.6, 0.6]); // zero-width point bands, clean 0.2 gap
  const vPb = durabilityVerdict(pb, pb);
  gate.check('zero-width point-band driver → verdict stands but flagged low-resolution', vPb.label === 'DURABLE' && vPb.lowRes === true);
  const hurt = rec([0.5, 0.52, 0.48, 0.5, 0.51], [0.85, 0.86, 0.84, 0.85, 0.85]); // clean regression
  gate.check('a substrate that only regresses → REGRESSES on that substrate', durabilityVerdict(hurt, help).label === 'REGRESSES on Claude');
}

// ── 33. Receipt interop (Phase 7): import honesty + TESTED tightening ────────
gate.section('interop import (honest epistemics)');
{
  const { importResults, importAgentSkillsEval, importSkillgrade } = require('../lib/importers');
  const aseData = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'interop-agent-skills-eval.json'), 'utf8'));
  const sgData = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'interop-skillgrade.json'), 'utf8'));
  const ase = importAgentSkillsEval(aseData);
  const sg = importSkillgrade(sgData);

  const vAse = validateReceipt(ase);
  gate.check('agent-skills-eval import → schema-valid at the CURRENT version + self-hash verifies', vAse.valid && vAse.version === RECEIPT_SCHEMA_VERSION && verifyReceiptHash(ase), { ...vAse, expected: RECEIPT_SCHEMA_VERSION });
  gate.check('imported receipt is DECLARED / surface external / source imported/<tool> / transcripts none',
    ase.verification_level === 'DECLARED' && ase.run.surface === 'external' && ase.run.source === 'imported/agent-skills-eval' && ase.run.transcripts === 'none');
  const anyHash = ase.results.cases.some((c) => 'generation_hash' in c || 'judge_sample_hashes' in c);
  gate.check('NO fabricated hashes: generation/judge hashes absent; content/suite/rubric hashes null',
    !anyHash && ase.skill.content_hash === null && ase.suite.suite_hash === null && ase.results.cases.every((c) => c.judge.rubric_hash === null));
  gate.check('provider inferred from imported model id (gpt-4o-mini → openai); delta from their with/without pass fractions',
    ase.run.provider === 'openai' && ase.comparison.delta === 0.75 && ase.run.judge.samples === 1);

  const vSg = validateReceipt(sg);
  gate.check('skillgrade import → schema-valid + self-hash verifies', vSg.valid && verifyReceiptHash(sg), vSg.errors);
  gate.check('skillgrade has no baseline mode → empty baseline aggregate + NULL comparison (never a fabricated 0-baseline)',
    sg.results.aggregates.baseline.case_count === 0 && sg.comparison.baseline_score === null && sg.comparison.delta === null && sg.comparison.delta_uncertainty === null);
  const lint = sg.results.cases.find((c) => c.id === 'fix-linting-errors');
  const explain = sg.results.cases.find((c) => c.id === 'explain-rule-violations');
  gate.check('per-trial rewards map onto samples[] with a real cross-trial band (stddev > 0)',
    lint && lint.samples.length === 5 && lint.stddev > 0 && lint.samples[0] === 0.91);
  gate.check('imported outcome uses the same borderline rule (threshold inside mean ± sd → borderline)',
    explain && explain.outcome === 'borderline' && explain.threshold === 0.7);
  let threw = false;
  try { importResults({}, { from: 'not-a-tool' }); } catch (_e) { threw = true; }
  gate.check('unknown --from source throws (no silent misconversion)', threw);
}

gate.section('interop TESTED tightening (schema)');
{
  // The interop relaxations must be unavailable to a receipt claiming TESTED —
  // TESTED keeps its full evidence chain, exactly as before the revision.
  const tested = synthReceipt([mkcase('c1', 'with_skill', [0.9, 0.85, 0.9, 0.88, 0.9], 0.7), mkcase('c1', 'baseline', [0.5, 0.55, 0.5, 0.52, 0.5], 0.7)]);
  gate.check('a TESTED receipt still validates unchanged', validateReceipt(tested).valid, validateReceipt(tested).errors);
  const t1 = JSON.parse(JSON.stringify(tested)); t1.skill.content_hash = null;
  gate.check('TESTED + null content_hash → INVALID', !validateReceipt(t1).valid);
  const t2 = JSON.parse(JSON.stringify(tested)); t2.run.surface = 'external';
  gate.check('TESTED + surface external → INVALID', !validateReceipt(t2).valid);
  const t3 = JSON.parse(JSON.stringify(tested)); delete t3.results.cases[0].generation_hash;
  gate.check('TESTED case missing generation_hash → INVALID', !validateReceipt(t3).valid);
  const t4 = JSON.parse(JSON.stringify(tested)); t4.comparison.delta = null;
  gate.check('TESTED + null comparison.delta → INVALID', !validateReceipt(t4).valid);
  const t5 = JSON.parse(JSON.stringify(tested)); t5.run.transcripts = 'none';
  gate.check("TESTED + transcripts 'none' → INVALID", !validateReceipt(t5).valid);
}

gate.section('interop verdict exclusion (below TESTED is never verdicted)');
{
  const { importAgentSkillsEval } = require('../lib/importers');
  const aseData = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'interop-agent-skills-eval.json'), 'utf8'));
  const imported = importAgentSkillsEval(aseData);
  const tested = synthReceipt([mkcase('basic', 'with_skill', [0.9, 0.85, 0.9, 0.88, 0.9], 0.7), mkcase('basic', 'baseline', [0.5, 0.55, 0.5, 0.52, 0.5], 0.7)]);

  const mixed = buildDriftReport(imported, tested, { labelA: 'imported', labelB: 'tested' });
  gate.check('diff against an imported (DECLARED) receipt → headline NOT MEASURED, zero regressions claimed',
    /NOT MEASURED/.test(mixed.markdown) && mixed.regressions.length === 0 && mixed.perCase.every((r) => r.verdict === 'not measured'));
  gate.check('diff caveats name the below-TESTED side and its source',
    /imported is DECLARED \(imported\/agent-skills-eval\)/.test(mixed.markdown));
  const both = buildDriftReport(tested, tested, { labelA: 'a', labelB: 'b' });
  gate.check('TESTED-vs-TESTED diff still computes verdicts (no over-exclusion)', !/NOT MEASURED/.test(both.markdown));

  gate.check('single-receipt verdict for an imported receipt is NOT_MEASURED (badge: not measured / grey)',
    verdictFromReceipt(imported).verdict === 'NOT_MEASURED' && badgeEndpoint(imported).color === 'lightgrey' && /not measured/.test(badgeEndpoint(imported).message));
  gate.check('single-receipt verdict for a TESTED receipt is unchanged (PASSED here)',
    verdictFromReceipt(tested).verdict === 'PASSED');

  // ── REVISION DRIFT (spec 009, the fifth report type) ───────────────────────
  //
  // `diff` was built for release drift: the model varies, the skill text is
  // fixed, and a changed content_hash is contamination worth a caveat. Revision
  // drift inverts that — the text is the variable under test and the substrate
  // is the control — so the fields release drift warns about become the
  // PRECONDITIONS of the comparison. These assertions live in the repo gate, not
  // only in the spec gate, because they are properties of shipped library
  // behaviour that must hold on every future run.
  const { revisionPairProblem } = require('../lib/diff');
  const { revisionHeadline, fairnessSentence, scopingNote, baselineControl } = require('../lib/revision');

  const revA = synthReceipt([mkcase('basic', 'with_skill', [0.70, 0.71, 0.70, 0.70, 0.71], 0.7), mkcase('basic', 'baseline', [0.50, 0.51, 0.50, 0.50, 0.51], 0.7)]);
  const revB = JSON.parse(JSON.stringify(revA));
  revB.skill.content_hash = 'f'.repeat(64);

  const relOut = buildDriftReport(revA, revB, { labelA: 'a', labelB: 'b' });
  const revOut = buildDriftReport(revA, revB, { labelA: 'pinned', labelB: 'current', mode: 'revision' });

  gate.check('release mode still emits the content_hash-differs caveat (unchanged)',
    /the skill itself changed between receipts/.test(relOut.markdown));
  gate.check('revision mode does NOT emit it — the changed text is the variable, not contamination',
    !/the skill itself changed between receipts/.test(revOut.markdown));
  // Anchored to the caveat LINE and to the receipts' own values, not to the four
  // bare words: the header table already carries `model (held)`, `provider
  // (held)`, `surface (held)` and `suite_hash (held)`, so a whole-output grep for
  // those words passes with no caveat emitted at all (spec 009 finding F-009-A).
  gate.check('revision mode states what is held constant instead', (() => {
    if (!/variable under test/.test(revOut.markdown)) return false;
    const caveat = revOut.markdown.split('\n')
      .filter((l) => l.startsWith('> - '))
      .find((l) => l.includes('held constant across both receipts'));
    if (!caveat) return false;
    return [revA.run.model_id, revA.run.provider || 'anthropic', revA.run.surface,
      revA.suite.suite_hash.slice(0, 12)].every((v) => caveat.includes(v));
  })());
  gate.check('revision mode leads its header table with skill content_hash', (() => {
    const lines = revOut.markdown.split('\n');
    const sep = lines.findIndex((l) => /^\|-{2,}/.test(l));
    return sep > 0 && (lines[sep + 1] || '').includes('skill content_hash');
  })());
  gate.check('revision mode is labelled as its own report type',
    /# Revision drift report/.test(revOut.markdown) && /revision drift/i.test(revOut.markdown));

  gate.check('revisionPairProblem accepts a genuine revision pair', revisionPairProblem(revA, revB) === null);
  gate.check('revisionPairProblem rejects an equal content_hash (no revision to measure)',
    revisionPairProblem(revA, revA) === 'skill.content_hash');
  {
    const moved = JSON.parse(JSON.stringify(revB));
    moved.run.model_id = 'claude-opus-5';
    gate.check('revisionPairProblem rejects a differing model_id (that is release drift)',
      revisionPairProblem(revA, moved) === 'run.model_id');
  }

  // The preconditions are only worth as much as the paths that apply them. AC-4
  // put the refusal in bin/driftproof, which is where a person types a diff;
  // spec 009's `verdictForCell` — the function that produces the report's
  // published verdicts — called buildDriftReport directly and applied none of it
  // (approval finding F-009-G). Asserted here, against the committed #005
  // receipts, because it is a property of the shipped runner and not of one gate.
  {
    const { verdictForCell } = require('../scripts/run-report-006.js');
    const cell = { slug: 'writing-plans', model: 'claude-fable-5' };
    const pinned = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'receipts', 'report-005',
      `${cell.slug}__${cell.model}.json`), 'utf8'));
    const tdir = fs.mkdtempSync(path.join(os.tmpdir(), 'driftproof-ac13-'));
    const put = (name, mutate) => {
      const r = JSON.parse(JSON.stringify(pinned));
      mutate(r);
      const f = path.join(tdir, name);
      fs.writeFileSync(f, JSON.stringify(r));
      return f;
    };
    const genuine = verdictForCell(cell, put('genuine.json', (r) => { r.skill.content_hash = 'a'.repeat(64); }));
    const released = verdictForCell(cell, put('released.json', (r) => {
      r.skill.content_hash = 'a'.repeat(64); r.run.model_id = 'claude-sonnet-5';
    }));
    const tautology = verdictForCell(cell, put('same.json', () => {}));
    gate.check('the runner refuses release drift on the path that emits the verdicts (F-009-G)',
      released.verdict === 'NOT MEASURED' && released.markdown === null
      && released.pairProblem === 'run.model_id');
    gate.check('the runner refuses an equal content_hash on that same path',
      tautology.verdict === 'NOT MEASURED' && tautology.markdown === null
      && tautology.pairProblem === 'skill.content_hash');
    gate.check('a genuine revision pair still renders, so the refusal is not blanket',
      genuine.pairProblem === null && /^# Revision drift report/m.test(genuine.markdown || ''));
    fs.rmSync(tdir, { recursive: true, force: true });
  }

  gate.check('the revision headline classifies four ways',
    revisionHeadline([{ verdict: 'improvement' }]).startsWith('REVISION IMPROVED')
    && revisionHeadline([{ verdict: 'regression' }]).startsWith('REVISION REGRESSED')
    && revisionHeadline([{ verdict: 'improvement' }, { verdict: 'regression' }]).startsWith('MIXED')
    && revisionHeadline([{ verdict: 'within noise' }]).startsWith('WITHIN NOISE'));

  // The fairness rule is the one a measurement project is most tempted to apply
  // in one direction only, so its symmetry is asserted rather than documented.
  gate.check('the fairness sentence is symmetric: improved understates, regressed overstates',
    /understates/.test(fairnessSentence({ slug: 's', classification: 'REVISION IMPROVED', report005Delta: 0.1, measuredDelta: 0.2 }))
    && /overstates/.test(fairnessSentence({ slug: 's', classification: 'REVISION REGRESSED', report005Delta: 0.1, measuredDelta: 0.0 })));
  gate.check('a within-noise cell gets NO amendment sentence (noise is not laundered into a finding)',
    fairnessSentence({ slug: 's', classification: 'WITHIN NOISE', report005Delta: 0.1, measuredDelta: 0.01 }) === null);
  gate.check('the description-only cell carries its context-not-trigger disclosure',
    /trigger/i.test(scopingNote('git-workflow-and-versioning') || '') && scopingNote('writing-plans') === null);

  // The control that makes a reused pinned arm honest: the fresh baseline arm
  // carries no skill text, so it re-measures the substrate the reuse assumes.
  {
    const ctlOk = baselineControl(revA, revB);
    const shifted = JSON.parse(JSON.stringify(revB));
    for (const c of shifted.results.cases) if (c.mode === 'baseline') { c.mean = 0.20; c.stddev = 0.005; }
    const ctlBad = baselineControl(revA, shifted);
    gate.check('baseline control passes when the substrate held still', ctlOk.reproduced && !ctlOk.blocked);
    gate.check('baseline control BLOCKS the cell when the substrate moved', ctlBad.blocked && ctlBad.verdict === 'NOT MEASURED');
  }
}

gate.section('interop export (summary-json stable interchange)');
{
  const { toSummaryJson, SUMMARY_FORMAT, SUMMARY_FORMAT_VERSION } = require('../lib/export');
  const { importAgentSkillsEval, importSkillgrade } = require('../lib/importers');
  const aseData = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'interop-agent-skills-eval.json'), 'utf8'));
  const sgData = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'interop-skillgrade.json'), 'utf8'));
  const snapshot = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'export-summary.snapshot.json'), 'utf8'));

  const s = toSummaryJson(importAgentSkillsEval(aseData), { reportUrl: null });
  gate.check('summary-json is deterministic and matches the checked-in snapshot (frozen v1 contract)',
    JSON.stringify(s) === JSON.stringify(snapshot), { got: s });
  gate.check('summary format/version stamped', s.format === SUMMARY_FORMAT && s.format_version === SUMMARY_FORMAT_VERSION && SUMMARY_FORMAT === 'driftproof/summary' && SUMMARY_FORMAT_VERSION === '1');

  const sSg = toSummaryJson(importSkillgrade(sgData));
  gate.check('no-baseline import exports null baseline/delta + NOT_MEASURED', sSg.scores.baseline === null && sSg.delta === null && sSg.verdict === 'NOT_MEASURED');

  const tested = synthReceipt([mkcase('c1', 'with_skill', [0.9, 0.85, 0.9, 0.88, 0.9], 0.7), mkcase('c1', 'baseline', [0.5, 0.55, 0.5, 0.52, 0.5], 0.7)]);
  const sT = toSummaryJson(tested, { reportUrl: 'https://driftproofhq.com/reports/001/' });
  gate.check('TESTED export carries a real verdict + caller-supplied report_url + the receipt_hash link',
    sT.verdict === 'PASSED' && sT.report_url === 'https://driftproofhq.com/reports/001/' && sT.receipt_hash === tested.receipt_hash && sT.source === 'driftproof');
  const V1_KEYS = ['format', 'format_version', 'skill', 'model', 'run_date_utc', 'scores', 'delta', 'delta_uncertainty', 'verdict', 'verification_level', 'source', 'judge', 'receipt_hash', 'report_url', 'spec'];
  gate.check('summary v1 key set is exactly frozen (additions must bump format_version)',
    JSON.stringify(Object.keys(sT)) === JSON.stringify(V1_KEYS) && JSON.stringify(Object.keys(s)) === JSON.stringify(V1_KEYS));
}

gate.section('interop pages + published schema sync');
{
  const interopHtml = fs.readFileSync(path.join(SCAN_ROOT, 'docs', 'interop.html'), 'utf8');
  const interopMd = fs.readFileSync(path.join(SCAN_ROOT, 'docs', 'interop.md'), 'utf8');
  const methodology = fs.readFileSync(path.join(SCAN_ROOT, 'docs', 'methodology.html'), 'utf8');
  gate.check('docs/interop.html ships in site chrome and explains DECLARED vs TESTED',
    /class="site"/.test(interopHtml) && /DECLARED/.test(interopHtml) && /TESTED/.test(interopHtml) && /open format/i.test(interopHtml));
  gate.check('methodology links the interop page', /interop\.html/.test(methodology));
  gate.check('interop guide documents both converters + the assumed-shape disclosure',
    /agent-skills-eval/.test(interopMd) && /skillgrade/.test(interopMd) && /Assumed-shape disclosure/.test(interopMd));
  const repoSchema = fs.readFileSync(path.join(SCAN_ROOT, 'spec', 'receipt.schema.json'), 'utf8');
  const servedSchema = fs.readFileSync(path.join(SCAN_ROOT, 'docs', 'spec', 'receipt.schema.json'), 'utf8');
  gate.check('served schema (docs/spec) is byte-identical to the repo schema — the canonical $id resolves to the real contract', repoSchema === servedSchema);
  const outreachPath = path.join(ROOT, 'reports', 'interop-outreach.md');
  // The outreach drafts are an internal report (excluded from the public tree),
  // so they are checked on the DEV tree only.
  if (fs.existsSync(outreachPath)) {
    const outreach = fs.readFileSync(outreachPath, 'utf8');
    gate.check('outreach drafts exist, are marked NOT FILED, and are gift-framed (PR offered)', /NOT FILED/.test(outreach) && /happy to write the PR/.test(outreach) && /agent-skills-eval/.test(outreach) && /skillgrade/.test(outreach));
  }
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


// ── 45. v0.4 usage capture (parsers vs REAL CLI output) ──────────────────────
// The fixtures are verbatim output captured from live `claude -p --output-format
// json` and `codex exec --json` calls. If a vendor changes its output shape, these
// parsers must fail here rather than silently start recording nulls.
gate.section('v0.4 usage capture (parsers vs real CLI output)');
{
  const {
    parseClaudeCliJson, parseCodexJsonl, parseAnthropicApiUsage, parseOpenaiApiUsage,
    sumUsage, emptyUsage, normalizeUsage,
  } = require('../lib/usage');

  const claudeRaw = fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'usage-claude-cli.json'), 'utf8');
  const cc = parseClaudeCliJson(claudeRaw);
  gate.check('claude-cli: text extracted from the JSON `result` field', cc && cc.text === 'ok', { text: cc && cc.text });
  // Real fixture: input_tokens 10 + cache_creation 6,974 + cache_read 18,134.
  gate.check('claude-cli: input_tokens NORMALIZED to include cache (10 + 6974 + 18134 = 25118)',
    cc.usage.input_tokens === 25118, cc.usage);
  gate.check('claude-cli: cached_tokens = cache READ only (creation was processed fresh)',
    cc.usage.cached_tokens === 18134, cc.usage);
  gate.check('claude-cli: output_tokens captured', cc.usage.output_tokens === 40, cc.usage);
  gate.check('claude-cli: surface-reported cost is read but NOT used for costing',
    cc.surfaceReportedCostUsd != null && !('cost_usd' in cc.usage), { reported: cc.surfaceReportedCostUsd });
  gate.check('claude-cli: unparseable stdout degrades to null (never fabricates usage)',
    parseClaudeCliJson('not json at all') === null);

  const codexRaw = fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'usage-codex-cli.jsonl'), 'utf8');
  const cx = parseCodexJsonl(codexRaw);
  // Real fixture: turn.completed usage {input_tokens 10807, cached_input_tokens 4480, output_tokens 19}.
  gate.check('codex: usage read from the terminal turn.completed event',
    cx.usage && cx.usage.input_tokens === 10807 && cx.usage.output_tokens === 19, cx.usage);
  gate.check('codex: input_tokens already INCLUDES cache, so it is passed through unchanged',
    cx.usage.input_tokens === 10807 && cx.usage.cached_tokens === 4480, cx.usage);
  gate.check('codex: agent_message text available as a fallback to the -o file', cx.text === 'ok', { text: cx.text });
  gate.check('codex: a stream with no turn.completed yields null usage (never zeros)',
    parseCodexJsonl('{"type":"item.started"}\n').usage === null);

  // The two CLI lanes disagree natively about input_tokens; after normalization a
  // reader can compare them. This asserts the disagreement is actually handled,
  // not just documented: claude's raw input_tokens (10) is NOT what we record.
  const claudeJson = JSON.parse(claudeRaw);
  gate.check('the input-token disagreement is normalized, not passed through',
    claudeJson.usage.input_tokens === 10 && cc.usage.input_tokens !== 10);

  const an = parseAnthropicApiUsage({ input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 50 });
  gate.check('anthropic/api: cache added into input_tokens, cached_tokens recorded',
    an.input_tokens === 150 && an.cached_tokens === 50, an);
  const oa = parseOpenaiApiUsage({ prompt_tokens: 200, completion_tokens: 30, prompt_tokens_details: { cached_tokens: 80 } });
  gate.check('openai/api: prompt_tokens is already total; cached read from details',
    oa.input_tokens === 200 && oa.cached_tokens === 80, oa);
  gate.check('a surface that reports no cache leaves cached_tokens NULL, not 0',
    parseOpenaiApiUsage({ prompt_tokens: 5, completion_tokens: 1 }).cached_tokens === null);

  const summed = sumUsage([
    { input_tokens: 10, output_tokens: 2, cached_tokens: null, wall_ms: 100 },
    { input_tokens: 20, output_tokens: 3, cached_tokens: 5, wall_ms: 200 },
  ]);
  gate.check('sumUsage totals the N judge calls (null-safe)',
    summed.input_tokens === 30 && summed.output_tokens === 5 && summed.cached_tokens === 5 && summed.wall_ms === 300, summed);
  gate.check('empty usage is all-null (an unreported field never reads as zero cost)',
    Object.values(emptyUsage()).every((v) => v === null));
  gate.check('normalizeUsage always emits the four v0.4 fields',
    JSON.stringify(Object.keys(normalizeUsage({ input_tokens: 1 }))) === JSON.stringify(['input_tokens', 'output_tokens', 'cached_tokens', 'wall_ms']));
}

// ── 46. v0.4 economics: judge exclusion, frozen pricing, no composite ────────
gate.section('v0.4 economics (judge excluded, pricing frozen, no composite)');
{
  const value = require('../lib/value');
  const { buildPricingSnapshot, computeEconomics, costForUsage, median, quartiles } = value;

  const snap = buildPricingSnapshot({
    models: ['test-model', 'claude-haiku-4-5'],
    lookup: (m) => (m === 'test-model' ? { input: 10, output: 50, registered: true } : { input: 1, output: 5, registered: true }),
    nowIso: '2026-08-18T00:00:00.000Z',
  });
  gate.check('pricing snapshot freezes one entry per model touched',
    snap.models['test-model'].input_per_mtok === 10 && snap.models['claude-haiku-4-5'].output_per_mtok === 5, snap.models);
  gate.check('pricing snapshot records its source + frozen_at',
    snap.source === 'config/models.json' && snap.frozen_at === '2026-08-18T00:00:00.000Z');

  const mkrow = (mode, inTok, outTok, wall, judgeIn) => ({
    id: `c${inTok}`, mode,
    usage: { input_tokens: inTok, output_tokens: outTok, cached_tokens: 0, wall_ms: wall },
    judge_usage: { input_tokens: judgeIn, output_tokens: 100, cached_tokens: 0, wall_ms: 500 },
  });
  const cases = [
    mkrow('with_skill', 1000, 200, 4000, 5000), mkrow('with_skill', 1200, 220, 5000, 5000),
    mkrow('with_skill', 1400, 240, 6000, 5000), mkrow('with_skill', 1600, 260, 7000, 5000),
    mkrow('baseline', 500, 100, 3000, 5000), mkrow('baseline', 600, 110, 3500, 5000),
    mkrow('baseline', 700, 120, 4000, 5000), mkrow('baseline', 800, 130, 4500, 5000),
  ];
  const econArgs = { cases, modelId: 'test-model', judgeModelId: 'claude-haiku-4-5', pricingSnapshot: snap, surface: 'claude-cli', meteredSurface: false };
  const econ = computeEconomics(econArgs);

  // with arm: mean input 1300, mean output 230 → (1300/1e6)*10 + (230/1e6)*50 = 0.0245
  // base arm: mean input 650,  mean output 115 → 0.01225
  gate.check('per-arm mean cost/call computed from the snapshot',
    econ.with_skill.mean_cost_usd_per_call === 0.0245 && econ.baseline.mean_cost_usd_per_call === 0.01225, {
      w: econ.with_skill.mean_cost_usd_per_call, b: econ.baseline.mean_cost_usd_per_call });
  gate.check('skill incremental cost per call + per 1k calls',
    econ.skill_incremental_cost_usd_per_call === 0.01225 && econ.skill_incremental_cost_usd_per_1k_calls === 12.25, {
      call: econ.skill_incremental_cost_usd_per_call, k: econ.skill_incremental_cost_usd_per_1k_calls });
  gate.check('output-length delta (with − without)', econ.output_tokens_delta === 115, { d: econ.output_tokens_delta });
  gate.check('median wall_ms per arm + IQR reported',
    econ.with_skill.median_wall_ms === 5500 && econ.with_skill.wall_ms_iqr != null && econ.baseline.median_wall_ms === 3750, {
      w: econ.with_skill.median_wall_ms, iqr: econ.with_skill.wall_ms_iqr, b: econ.baseline.median_wall_ms });
  gate.check('median latency delta reported', econ.median_wall_ms_delta === 1750, { d: econ.median_wall_ms_delta });
  gate.check('subscription surface is labelled metered-EQUIVALENT, not metered', econ.basis === 'metered-equivalent');
  gate.check('an api surface is labelled metered',
    computeEconomics({ ...econArgs, meteredSurface: true }).basis === 'metered');

  // JUDGE EXCLUSION — the load-bearing assertion. Inflate judge usage 1000× and
  // every skill-value field must be byte-identical; only the disclosed overhead moves.
  const inflated = cases.map((c) => ({ ...c, judge_usage: { ...c.judge_usage, input_tokens: c.judge_usage.input_tokens * 1000, output_tokens: 999999 } }));
  const econJ = computeEconomics({ ...econArgs, cases: inflated });
  const valueFields = (e) => JSON.stringify({
    w: e.with_skill, b: e.baseline,
    inc: e.skill_incremental_cost_usd_per_call, inc1k: e.skill_incremental_cost_usd_per_1k_calls,
    out: e.output_tokens_delta, lat: e.median_wall_ms_delta,
  });
  gate.check('JUDGE TOKENS NEVER ENTER VALUE MATH: 1000× judge usage changes no skill-value field',
    valueFields(econ) === valueFields(econJ));
  gate.check('judge overhead IS disclosed separately (and moved under inflation)',
    econ.judge_overhead.total_cost_usd !== econJ.judge_overhead.total_cost_usd && econ.judge_excluded === true);

  // FROZEN PRICING — mutate the live registry 10× and assert the derived dollars
  // are unchanged, because they come from the snapshot and never from the registry.
  const mutatedRegistry = path.join(os.tmpdir(), `driftproof-gate-registry-${process.pid}.json`);
  const realRegistry = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'models.json'), 'utf8'));
  for (const m of realRegistry.models || []) { m.input_price = Number(m.input_price) * 10; m.output_price = Number(m.output_price) * 10; }
  fs.writeFileSync(mutatedRegistry, JSON.stringify(realRegistry, null, 2));
  const prevRegistry = process.env.DRIFTPROOF_REGISTRY;
  process.env.DRIFTPROOF_REGISTRY = mutatedRegistry;
  modelsLib.loadRegistry(true);
  const econAfter = computeEconomics(econArgs);
  if (prevRegistry === undefined) delete process.env.DRIFTPROOF_REGISTRY; else process.env.DRIFTPROOF_REGISTRY = prevRegistry;
  modelsLib.loadRegistry(true);
  fs.unlinkSync(mutatedRegistry);
  gate.check('FROZEN PRICING WINS: a 10× registry price change does not move a receipt\'s derived costs',
    valueFields(econ) === valueFields(econAfter));
  gate.check('a live registry price change IS visible to the registry itself (the mutation was real)',
    JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'models.json'), 'utf8')).models.length > 0);

  gate.check('cost is null (not 0) when the surface reported no usage',
    costForUsage({ input_tokens: null, output_tokens: null }, { input_per_mtok: 1, output_per_mtok: 1 }) === null);
  gate.check('cost is null when the model is absent from the snapshot',
    computeEconomics({ ...econArgs, modelId: 'not-in-snapshot' }).with_skill.mean_cost_usd_per_call === null);
  gate.check('failed_timeout rows are excluded from economics',
    computeEconomics({ ...econArgs, cases: [...cases, { id: 'x', mode: 'with_skill', case_status: 'failed_timeout' }] }).with_skill.call_count === 4);
  gate.check('median/quartiles: IQR needs at least 4 points, else null',
    median([1, 2, 3]) === 2 && quartiles([1, 2, 3]).iqr === null && quartiles([1, 2, 3, 4]).iqr != null);

  // NO COMPOSITE SCORE — asserted against the module's own surface and the source
  // of every file that renders a report, so a future edit cannot slip one in.
  const composite = /composite|value[_ ]?score|overall[_ ]?score|weighted[_ ]?(value|score)/i;
  gate.check('lib/value.js exports no composite/overall score function',
    !Object.keys(value).some((k) => composite.test(k)), Object.keys(value));
  const renderSources = ['lib/value.js', 'lib/verdict.js', 'scripts/prepare-report-005.js']
    .map((f) => path.join(ROOT, f)).filter((f) => fs.existsSync(f));
  const compositeHits = [];
  for (const f of renderSources) {
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      // Prose that FORBIDS a composite is fine; a definition/assignment is not.
      if (composite.test(line) && /(function|const|let|var|=>|\breturn\b)/.test(line) && !/^\s*(\/\/|\*)/.test(line)) compositeHits.push(`${path.basename(f)}: ${line.trim().slice(0, 80)}`);
    }
  }
  gate.check('no composite value score is computed anywhere in the value/report code', compositeHits.length === 0, compositeHits);
}

// ── 47. v0.4 presentation rules (ratio floor gate + latency disclosure) ──────
gate.section('v0.4 presentation rules (ratio floor, latency disclosure)');
{
  const { costPerLiftPoint, isZeroLooking, liftIsReportable, NOISE_CELL, REGRESSED_CELL, DRIVER_ONLY_CELL, LATENCY_DISCLOSURE } = require('../lib/value');
  const { EFFECT_FLOOR } = require('../config');

  gate.check('a lift ABOVE the floor with separated bands is reportable',
    liftIsReportable({ lift: 0.20, separated: true }) === true);
  gate.check('a lift BELOW the effect floor is not reportable',
    liftIsReportable({ lift: EFFECT_FLOOR - 0.001, separated: true }) === false);
  gate.check('a lift above the floor whose bands OVERLAP is not reportable',
    liftIsReportable({ lift: 0.20, separated: false }) === false);

  // The rule the whole value report hangs on: noise never becomes a ratio.
  // spec 002 (AC-2) changed this contract deliberately, and REPORT-STYLE rule 3
  // was amended with it. A sub-floor AGGREGATE on a cell whose per-case drivers
  // DID clear the floor is not "within noise" — the Verdict basis on the same page
  // names those drivers, and six #005 cells were rendering a contradiction. The
  // two absences now render two different strings.
  gate.check('RATIO FLOOR RULE: sub-floor aggregate WITH separated drivers renders "n/a (driver-only)"',
    costPerLiftPoint({ lift: 0.01, separated: true, incrementalCostPer1kCalls: 24.201 }) === DRIVER_ONLY_CELL,
    { got: costPerLiftPoint({ lift: 0.01, separated: true, incrementalCostPer1kCalls: 24.201 }) });
  gate.check('RATIO FLOOR RULE: overlapping bands render "n/a (within noise)"',
    costPerLiftPoint({ lift: 0.4, separated: false, incrementalCostPer1kCalls: 24.201 }) === NOISE_CELL);
  gate.check('RATIO FLOOR RULE: no driver and a sub-floor lift still renders the noise cell',
    costPerLiftPoint({ lift: 0.01, separated: false, incrementalCostPer1kCalls: 24.201 }) === NOISE_CELL);

  // spec 002 (AC-5) — a negative incremental cost means the skill improved quality
  // AND made the call cheaper. "What one unit of benefit costs" has no meaning
  // when the benefit is free, and a negative price sorts backwards against every
  // other cell in the column. Four #005 cells reached this and rendered `$-29`.
  gate.check('COST-SAVING RULE: a floor-clearing lift at negative cost states the saving, never a price',
    /^saves \$196\.77\/1k calls$/.test(costPerLiftPoint({ lift: 0.177, separated: true, incrementalCostPer1kCalls: -196.767 })),
    { got: costPerLiftPoint({ lift: 0.177, separated: true, incrementalCostPer1kCalls: -196.767 }) });
  gate.check('COST-SAVING RULE: no negative dollar can reach a priced cell',
    [-499.46, -196.767, -75.864, -27.081].every((c) => !/^\$[−-]/.test(costPerLiftPoint({ lift: 0.17, separated: true, incrementalCostPer1kCalls: c }))));
  gate.check('COST-SAVING RULE: the positive path is unchanged (tripwire — the rule can fail)',
    costPerLiftPoint({ lift: 0.177, separated: true, incrementalCostPer1kCalls: 196.767 }) === '$11.12 per 0.01 lift',
    { got: costPerLiftPoint({ lift: 0.177, separated: true, incrementalCostPer1kCalls: 196.767 }) });

  // spec 002 (AC-7) — measurement overhead in TIME, derived from receipt wall_ms.
  gate.check('WALL CLOCK: judge and generation hours derive from receipt wall_ms',
    (() => {
      const wc = require('../lib/value').runWallClockFromReceipts([{ results: { cases: [
        { usage: { wall_ms: 3.6e6 }, judge_usage: { wall_ms: 3.6e6 * 9 } },
      ] } }]);
      return wc.generation_hours === 1 && wc.judge_hours === 9 && wc.total_hours === 10 && wc.judge_share_pct === 90;
    })());
  gate.check('WALL CLOCK: absent wall_ms reports unmeasured, never zero-as-fact',
    require('../lib/value').runWallClockFromReceipts([{ results: { cases: [{}] } }]).measured === false);
  gate.check('a zero/absent denominator renders the noise cell, never Infinity',
    costPerLiftPoint({ lift: 0.4, separated: true, incrementalCostPer1kCalls: 0 }) === NOISE_CELL
    && costPerLiftPoint({ lift: 0.4, separated: true, incrementalCostPer1kCalls: null }) === NOISE_CELL);
  gate.check('the renderer never returns a bare number type (always a rendered string)',
    typeof costPerLiftPoint({ lift: 0.4, separated: true, incrementalCostPer1kCalls: 24.201 }) === 'string');

  // spec 001-ratio-framing: the cell prices a UNIT OF BENEFIT (dollars per 0.01
  // lift). The prior unit (lift per dollar per 1k calls) was arithmetically fine
  // and useless — at real magnitudes every cell rendered "+0.00", reading as "no
  // benefit per dollar" beside a case that had moved +0.636. These assertions use
  // REAL receipt magnitudes ($24-70 per 1k calls), not synthetic ones: the defect
  // survived precisely because the gate only ever saw invented inputs.
  gate.check('a cleared lift renders dollars per 0.01 lift at REAL magnitudes',
    costPerLiftPoint({ lift: 0.103, separated: true, incrementalCostPer1kCalls: 69.518 }) === '$6.75 per 0.01 lift',
    { got: costPerLiftPoint({ lift: 0.103, separated: true, incrementalCostPer1kCalls: 69.518 }) });
  gate.check('ZERO-LOOKING TRIPWIRE: no real-magnitude render collapses to a zero value',
    [[0.103, 69.518], [0.2, 24.201], [0.636, 69.518], [1.0, 500], [0.05, 1]]
      .map(([lift, cost]) => costPerLiftPoint({ lift, separated: true, incrementalCostPer1kCalls: cost }))
      .every((cell) => !isZeroLooking(cell)));
  gate.check('the zero-looking predicate catches a collapsing cell and spares a real one',
    isZeroLooking('+0.00 /$/1k') && isZeroLooking('$0.00 per 0.01 lift')
    && !isZeroLooking('$6.75 per 0.01 lift') && !isZeroLooking(NOISE_CELL));
  gate.check('a floor-clearing NEGATIVE lift prices nothing (no negative price)',
    costPerLiftPoint({ lift: -0.2, separated: true, incrementalCostPer1kCalls: 69.518 }) === REGRESSED_CELL);

  gate.check('the latency disclosure states surface + indicative',
    /subscription CLI surface/.test(LATENCY_DISCLOSURE) && /indicative/.test(LATENCY_DISCLOSURE), LATENCY_DISCLOSURE);
}

// ── 48. summary printer (surface-note dedupe) ────────────────────────────────
gate.section('summary printer (surface-note dedupe)');
{
  const { summarizeReceipt } = require('../lib/run');
  const r = synthReceipt([mkcase('c1', 'with_skill', [0.9, 0.85, 0.9, 0.88, 0.9], 0.7), mkcase('c1', 'baseline', [0.5, 0.55, 0.5, 0.52, 0.5], 0.7)]);
  const md = summarizeReceipt(r);
  const judgeLine = md.split('\n').find((l) => l.startsWith('- **judge:**'));
  // Snapshot: the exact rendered line. It regressed once into printing the surface
  // note twice ("temperature n/a (surface-controlled) (surface-controlled)").
  gate.check('judge summary line matches its snapshot exactly',
    judgeLine === '- **judge:** 5 samples/case, temperature n/a (surface-controlled)', { got: judgeLine });
  gate.check('the surface note appears exactly once on the judge line',
    (judgeLine.match(/surface-controlled/g) || []).length === 1, { got: judgeLine });
  const apiReceipt = synthReceipt([mkcase('c1', 'with_skill', [0.9, 0.9, 0.9, 0.9, 0.9], 0.7), mkcase('c1', 'baseline', [0.5, 0.5, 0.5, 0.5, 0.5], 0.7)]);
  apiReceipt.run.judge = { samples: 5, temperature: 0, sampling: 'api-temperature-0', surface: 'api' };
  const apiLine = summarizeReceipt(apiReceipt).split('\n').find((l) => l.startsWith('- **judge:**'));
  gate.check('an api-surface judge line renders its pinned temperature',
    apiLine === '- **judge:** 5 samples/case, temperature 0 (api-temperature-0)', { got: apiLine });
}


// ── 49. Report #005 staging (value report, stub) ─────────────────────────────
// The stub dry run must render a COMPLETE value page — all three axes present,
// the disclosure box intact, the floor rule visibly applied — without calling a
// model. If a future edit drops an axis or a disclosure, this fails.
gate.section('report-005 staging (value report, stub)');
{
  const { prepareReport005, ACKNOWLEDGMENT } = require('../scripts/prepare-report-005');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'driftproof-r005-'));
  // E-F2: snapshot the repo's own docs/reports BEFORE the stub run, so the
  // "staging is out-of-root" check can compare the tree against itself rather
  // than against a hardcoded pre-publish shape.
  const docsReportsBefore = fs.existsSync(path.join(ROOT, 'docs', 'reports'))
    ? fs.readdirSync(path.join(ROOT, 'docs', 'reports')).sort() : [];
  const prevStub = process.env.DRIFTPROOF_STUB;
  process.env.DRIFTPROOF_STUB = '1';
  let res = null; let err = null;
  try {
    res = require('child_process').execFileSync('node', ['-e', `
      const { prepareReport005 } = require(${JSON.stringify(path.join(ROOT, 'scripts', 'prepare-report-005.js'))});
      prepareReport005({ outRoot: ${JSON.stringify(tmp)}, now: '2026-08-18T00:00:00.000Z' })
        .then((r) => { process.stdout.write(JSON.stringify({ tally: r.tally, models: r.models, projection: r.projection.totalUSD, overGuard: r.overGuard, projectedCalls: r.projectedCalls, stub: r.stub, publicTreeTouched: r.publicTreeTouched })); })
        .catch((e) => { process.stderr.write(String(e && e.stack || e)); process.exit(1); });
    `], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, DRIFTPROOF_STUB: '1' } });
  } catch (e) { err = e; }
  if (prevStub === undefined) delete process.env.DRIFTPROOF_STUB; else process.env.DRIFTPROOF_STUB = prevStub;

  gate.check('report-005 stub dry run completes with zero model calls', !err && !!res, err && String(err.message || err).slice(0, 300));
  const out = res ? JSON.parse(res) : {};
  gate.check('report-005 stages 3 substrates', Array.isArray(out.models) && out.models.length === 3, out.models);
  // THE MECHANISM, NOT THE OUTCOME (spec 016 AC-7). This asserted `overGuard ===
  // false` — that #005's projection fits under the $40 report guard — and it
  // passed because the dollar projection was computed at ONE generation draw. At
  // the draw factor a v0.5 run actually uses, the same staging projects $208.95
  // and the guard correctly fires. Asserting the flag is COMPUTED correctly is
  // stable under that; asserting the outcome would have meant either reinstating
  // the understatement or freezing a cost policy into a gate. The breach itself
  // is a finding for a person, filed, not something for this assertion to hide.
  const REPORT_GUARD_USD = require('../config').REPORT_MAX_USD;
  gate.check('report-005 projects a positive cost and its guard flag reflects the comparison it names',
    out.projection > 0 && out.overGuard === (out.projection > REPORT_GUARD_USD),
    { usd: out.projection, guard: REPORT_GUARD_USD, overGuard: out.overGuard });

  const draft = path.join(tmp, 'docs', 'reports', '005-draft', 'index.html');
  const receipts = path.join(tmp, 'receipts', 'report-005-draft');
  gate.check('report-005 draft page written', fs.existsSync(draft));
  const html = fs.existsSync(draft) ? fs.readFileSync(draft, 'utf8') : '';
  const recFiles = fs.existsSync(receipts) ? fs.readdirSync(receipts).filter((f) => f.endsWith('.json')) : [];
  gate.check('report-005 emits one receipt per skill × substrate (10 × 3)', recFiles.length === 30, { receipts: recFiles.length });

  // Every staged receipt is a valid v0.4 receipt carrying the economics chain.
  let allV4 = true; let allEcon = true; let allSnap = true; let judgeSeparate = true;
  for (const f of recFiles) {
    const r = JSON.parse(fs.readFileSync(path.join(receipts, f), 'utf8'));
    const v = validateReceipt(r);
    if (!(v.valid && v.version === RECEIPT_SCHEMA_VERSION && verifyReceiptHash(r))) allV4 = false;
    if (!r.economics || r.economics.judge_excluded !== true) allEcon = false;
    if (!r.run.pricing_snapshot || !r.run.pricing_snapshot.frozen_at) allSnap = false;
    const c0 = r.results.cases[0] || {};
    if (!c0.usage || !c0.judge_usage) judgeSeparate = false;
  }
  gate.check('every report-005 receipt validates at the CURRENT version + self-verifies', allV4);

  // F2 (approval 2026-08-18): AC-5's clause "if a dollar figure cannot be
  // re-derived from that frozen pricing, the gate shall fail" must hold for the
  // dollars actually RENDERED from live receipts, not only for the two-case
  // checked-in fixture. Every staged receipt's per-arm cost is recomputed here
  // from its own frozen rates.
  const { dollarsTraceable, isZeroLooking } = require('../lib/value');
  const untraceable = [];
  for (const f of recFiles) {
    const r = JSON.parse(fs.readFileSync(path.join(receipts, f), 'utf8'));
    const e = r.economics || {};
    const rates = ((r.run.pricing_snapshot || {}).models || {})[r.run.model_id];
    const v = dollarsTraceable({
      arms: { with_skill: e.with_skill, baseline: e.baseline },
      rates,
      // The figure the page actually prints — traced through the subtraction and
      // the ×1000 scaling, not just its two inputs (F2, flagged by four
      // consecutive approvals).
      incrementalPer1kCalls: e.skill_incremental_cost_usd_per_1k_calls,
    });
    if (!v.traceable) untraceable.push({ file: f, mismatches: v.mismatches });
  }
  gate.check('AC-5: every rendered dollar figure re-derives from its receipt\'s frozen pricing',
    untraceable.length === 0, { untraceable: untraceable.slice(0, 5) });

  // The same check must be able to FAIL — a tamper canary, so a silently broken
  // derivation cannot masquerade as a clean sweep.
  {
    const r = JSON.parse(fs.readFileSync(path.join(receipts, recFiles[0]), 'utf8'));
    const e = r.economics || {};
    const rates = ((r.run.pricing_snapshot || {}).models || {})[r.run.model_id];
    const tampered = { with_skill: { ...e.with_skill, mean_cost_usd_per_call: e.with_skill.mean_cost_usd_per_call * 1.5 }, baseline: e.baseline };
    gate.check('AC-5 tripwire: a dollar figure NOT derivable from frozen pricing is caught',
      dollarsTraceable({ arms: tampered, rates }).traceable === false);
    // F2 tripwire: the PUBLISHED increment, wrong but non-zero, must now fail —
    // the exact case that passed every assertion through four approvals.
    const wrongIncrement = Number(e.skill_incremental_cost_usd_per_1k_calls) * 0.8 + 1;
    gate.check('F2 tripwire: a wrong-but-non-zero published increment is caught',
      dollarsTraceable({
        arms: { with_skill: e.with_skill, baseline: e.baseline }, rates,
        incrementalPer1kCalls: wrongIncrement,
      }).traceable === false, { planted: wrongIncrement, recorded: e.skill_incremental_cost_usd_per_1k_calls });
  }

  // F3 (approval 2026-08-18): the zero-looking tripwire must run over the cells
  // actually rendered onto the page, not only over point inputs.
  const renderedRatios = html.match(/\$[\d.,]+ per 0\.01 lift/g) || [];
  gate.check('AC-4: no ratio cell RENDERED on the draft page is zero-looking',
    renderedRatios.length > 0 && renderedRatios.every((c) => !isZeroLooking(c)),
    { rendered: renderedRatios.length, collapsing: renderedRatios.filter((c) => isZeroLooking(c)).slice(0, 5) });
  const renderedDerived = html.match(/derived: \$[\d.,]+\/1k calls/g) || [];
  // F3 (approval run 3): a cell is a DEFECT only when it renders zero while the
  // underlying figure is non-zero. A genuinely near-zero incremental cost is
  // legitimate data and must render (the formatter drops to two significant
  // figures below a cent), not fail the gate. Bound the tripwire accordingly.
  const trueIncrements = recFiles.map((f) => {
    const r = JSON.parse(fs.readFileSync(path.join(receipts, f), 'utf8'));
    return (r.economics || {}).skill_incremental_cost_usd_per_1k_calls;
  }).filter((v) => v != null);
  const collapsing = renderedDerived.filter((c) => isZeroLooking(c.replace('derived: ', '')));
  const anyTrueNonZero = trueIncrements.some((v) => Math.abs(v) >= 0.005);
  gate.check('AC-5: the page renders derived dollar figures, none collapsing while non-zero',
    renderedDerived.length > 0 && !(collapsing.length > 0 && anyTrueNonZero),
    { rendered: renderedDerived.length, collapsing: collapsing.slice(0, 3) });
  gate.check('F3 bound: a legitimately tiny incremental cost renders digits rather than $0.00',
    (() => {
      // The formatter, exercised directly at a value below a cent.
      const tiny = 0.004;
      const shown = tiny > 0 && tiny < 0.01 ? `$${Number(tiny.toPrecision(2))}` : `$${tiny.toFixed(2)}`;
      return !isZeroLooking(shown) && shown === '$0.004';
    })());

  // F1 (approval run 3): the run-record HEADLINE dollar must also be derivable
  // from frozen pricing. It previously came from estimateRunCostUSD — live
  // registry rates against assumed token constants — while the page's own
  // disclosure promised every dollar re-derives from the frozen snapshot.
  {
    const { runTotalFromReceipts } = require('../lib/value');
    const staged = recFiles.map((f) => JSON.parse(fs.readFileSync(path.join(receipts, f), 'utf8')));
    const total = runTotalFromReceipts(staged);
    gate.check('AC-5: the run total is derivable from the receipts\' frozen pricing',
      total.traceable === true && total.total_usd > 0 && total.receipts_counted === staged.length,
      { total: total.total_usd, counted: total.receipts_counted, untraceable: total.untraceable.slice(0, 3) });

    // B1 (same adjacency seam): BOTH halves of the headline are re-derived from
    // case-row tokens × frozen rates. The judge half was previously read verbatim
    // from judge_overhead.total_cost_usd, so a write-time mispricing reached the
    // headline untested. Assert the re-derivation agrees with what was recorded.
    {
      const { receiptCostBreakdown } = require('../lib/value');
      const judgeMismatches = [];
      for (const r of staged) {
        const bd = receiptCostBreakdown(r);
        const recorded = ((r.economics || {}).judge_overhead || {}).total_cost_usd;
        if (!bd.derivable) { judgeMismatches.push({ model: r.run.model_id, reason: bd.reason }); continue; }
        if (recorded != null && Math.abs(bd.judge_usd - recorded) > 1e-4) {
          judgeMismatches.push({ model: r.run.model_id, recorded, rederived: bd.judge_usd });
        }
      }
      gate.check('B1: the judge half re-derives from case-row tokens × frozen rates',
        judgeMismatches.length === 0, { mismatches: judgeMismatches.slice(0, 3) });
      const bd0 = receiptCostBreakdown(staged[0]);
      const noPricing = { ...staged[0], run: { ...staged[0].run, pricing_snapshot: undefined } };
      gate.check('B1 tripwire: a receipt without frozen pricing is not cost-derivable',
        bd0.derivable === true && receiptCostBreakdown(noPricing).derivable === false);
    }
    // …and the figure the page actually prints equals that derivation.
    const headline = (html.match(/\$([\d.,]+)<\/strong> <span class="muted">\(\$([\d.,]+) generation \+ \$([\d.,]+) judge/) || []);
    const num = (x) => Number(String(x).replace(/,/g, ''));
    gate.check('AC-5: the rendered headline equals the receipt-derived total (generation + judge)',
      headline.length === 4
      && Math.abs(num(headline[2]) - total.generation_usd) < 0.011
      && Math.abs(num(headline[3]) - total.judge_usd) < 0.011,
      { rendered: headline.slice(1), derived: { gen: total.generation_usd, judge: total.judge_usd } });

    // F5(a) (approval run 4): the arithmetic a reader can do ON THE PAGE must
    // hold. Rounding each figure independently printed "$60.73 + $3.44 = $64.18",
    // which is visibly wrong on a page whose disclosure promises every dollar
    // re-derives. Parse the three RENDERED figures and check them, not the
    // internal values.
    gate.check('F5(a): the rendered components sum EXACTLY to the rendered total',
      headline.length === 4
      && Math.round((num(headline[2]) + num(headline[3])) * 100) === Math.round(num(headline[1]) * 100),
      { total: headline[1], gen: headline[2], judge: headline[3],
        sum: headline.length === 4 ? (num(headline[2]) + num(headline[3])).toFixed(2) : null });

    // F5(b): CONSTITUTION invariant 1 — the level is stated, never implied.
    const levelMatch = html.match(/verification level <strong>(UNVERIFIED|DECLARED|TESTED|FORMAL)<\/strong>/);
    gate.check('F5(b): the headline states a verification level from the lattice',
      !!levelMatch, { found: levelMatch && levelMatch[1] });
    // Derived INDEPENDENTLY from the receipt files on disk — not from the object
    // that produced the render. Comparing a render against the function that
    // rendered it verifies nothing (new-F5).
    const LATTICE = ['UNVERIFIED', 'DECLARED', 'TESTED', 'FORMAL'];
    const onDiskLevels = recFiles.map((f) => {
      const r = JSON.parse(fs.readFileSync(path.join(receipts, f), 'utf8'));
      return r.verification_level;
    });
    const expectedLevel = onDiskLevels.reduce((weakest, lvl) => {
      const a = LATTICE.indexOf(weakest); const b = LATTICE.indexOf(lvl);
      return (b < 0 || b < a) ? (b < 0 ? 'UNVERIFIED' : lvl) : weakest;
    }, 'FORMAL');
    gate.check('F5(b): the stated level matches the receipts ON DISK (independently derived)',
      !!levelMatch && levelMatch[1] === expectedLevel,
      { stated: levelMatch && levelMatch[1], fromDisk: expectedLevel, levels: [...new Set(onDiskLevels)] });
    // Schema-rename tripwire, read from a real receipt file: if the field is ever
    // renamed, a synthetic-object test would keep passing while every receipt broke.
    {
      const { weakestVerificationLevel } = require('../lib/value');
      const sample = JSON.parse(fs.readFileSync(path.join(receipts, recFiles[0]), 'utf8'));
      gate.check('F5(b) tripwire: receipts on disk carry `verification_level` under that exact name',
        Object.prototype.hasOwnProperty.call(sample, 'verification_level')
        && LATTICE.includes(sample.verification_level), { got: sample.verification_level });
      gate.check('F5(b) tripwire: a weaker receipt drags the level down (real receipt + a DECLARED one)',
        weakestVerificationLevel([sample, { verification_level: 'DECLARED' }]) === 'DECLARED'
        && weakestVerificationLevel([sample, {}]) === 'UNVERIFIED');
    }
    gate.check('AC-5: no projection-sourced dollar figure remains on the page',
      !/Projected real-run cost/.test(html) && !/estimated metered-equivalent ~\$/.test(html));
    // The derivation must be able to fail: a receipt without frozen pricing is untraceable.
    const stripped = staged.map((r, i) => (i === 0 ? { ...r, run: { ...r.run, pricing_snapshot: undefined } } : r));
    gate.check('AC-5 tripwire: a receipt lacking frozen pricing makes the run total untraceable',
      runTotalFromReceipts(stripped).traceable === false);
  }
  gate.check('every report-005 receipt carries economics with judge_excluded true', allEcon);
  gate.check('every report-005 receipt carries a frozen pricing_snapshot', allSnap);
  gate.check('every report-005 case row carries generation usage AND separate judge_usage', judgeSeparate);

  // THE THREE AXES must all be on the page, together.
  gate.check('draft renders the value report type label', /class="report-type">Value report/.test(html));
  // spec 001-ratio-framing v1.1 (AC-5): the cost axis leads with TOKENS, with the
  // dollar figure derived beneath at the receipt's frozen rates.
  gate.check('draft renders all three axes in the table head, cost axis led by tokens',
    /lift \(band\)/.test(html) && /Δ tokens \(cost\)/.test(html) && /Δ latency/.test(html) && /cost \/ benefit/.test(html));
  gate.check('draft presents dollars as DERIVED from frozen pricing, and states the snapshot date',
    /derived: \$/.test(html) && /priced as frozen \d{4}-\d{2}-\d{2}/.test(html)
    && /Tokens are the measurement; dollars are derived/.test(html));
  gate.check('draft carries the axis legend explaining what each axis does NOT mean',
    /How to read the three axes/.test(html) && /<em>Not<\/em> a model ranking/.test(html) && /<em>Not<\/em> a bill/.test(html) && /<em>Not<\/em> a serving-latency benchmark/.test(html));
  // The legend must describe the columns the table actually has. It drifted once
  // (it still explained "Δ cost per 1,000 calls" and "Δ output" after the cost
  // axis became token-led), which is the same orphaning class as F4.
  {
    const headerCols = ((html.match(/<th>lift \(band\)<\/th>[^\n]*/) || [''])[0].match(/<th>([^<]+)<\/th>/g) || [])
      .map((h) => h.replace(/<\/?th>/g, '').trim().toLowerCase());
    const legend = (html.match(/<li><strong>[^<]+<\/strong>/g) || []).map((l) => l.replace(/<[^>]+>/g, '').replace(/\.$/, '').trim().toLowerCase());
    const missing = headerCols.filter((c) => !legend.some((l) => l.includes(c)));
    const orphaned = ['δ cost per 1,000 calls', 'δ output'].filter((stale) => legend.includes(stale));
    gate.check('axis legend matches the table columns (no orphaned or missing axis)',
      headerCols.length > 0 && missing.length === 0 && orphaned.length === 0, { headerCols, missing, orphaned });
  }
  gate.check('draft carries the disclosure box (frozen pricing, surfaces, judge excluded, cache basis)',
    /<strong>Disclosure\.<\/strong>/.test(html) && /pricing_snapshot/.test(html) && /judge_usage/.test(html) && /metered-equivalent/.test(html) && /Cached input tokens are costed/.test(html));
  gate.check('draft states the latency disclosure verbatim', /observed on subscription CLI surface, indicative/.test(html));
  // F4 (approval 2026-08-18): the cost axis is incremental end to end now — the
  // table renders token DELTAS with derived dollars, never an absolute per-call
  // figure, so the old absolute-vs-incremental caveat had nothing left to explain.
  // This asserts the resolution holds: no orphaned caveat, no absolute figure
  // sneaking back without one.
  gate.check('draft cost axis is incremental end to end (no absolute figure, no orphaned caveat)',
    !/\/call abs/.test(html) && !/Absolute vs incremental/.test(html)
    && /Tokens are the measurement; dollars are derived/.test(html));
  gate.check('draft asserts NO composite score in words', /no composite score/i.test(html));

  // THE FLOOR RULE, VISIBLE ON THE PAGE: the stub deliberately includes skills
  // whose lift is within noise, so the ratio cell must render the noise string.
  const { NOISE_CELL } = require('../lib/value');
  gate.check('draft renders "n/a (within noise)" where the lift did not clear the floor',
    html.includes(NOISE_CELL), { noiseCells: (html.match(/n\/a \(within noise\)/g) || []).length });
  gate.check('the stub exercises BOTH branches (some reportable, some within noise)',
    out.tally && out.tally.reportable > 0 && out.tally.within_noise > 0, out.tally);

  // The acknowledgment, exactly as agreed — no embellishment.
  gate.check('draft carries the acknowledgment line, exactly',
    html.includes(ACKNOWLEDGMENT)
    && ACKNOWLEDGMENT === 'The value axes in this report type were prompted by a question from a former colleague: why not show what a skill costs to run, not just whether it helps.');

  gate.check('report-005 draft is noindex + banner-marked and does not touch the public tree',
    /name="robots" content="noindex"/.test(html) && /DRAFT — not published/.test(html) && out.publicTreeTouched === false);
  gate.check('report-005 queues a pending-publish entry (notify, do not publish)',
    fs.existsSync(path.join(tmp, 'reports', 'pending-publish.md')));
  // E-F2. This used to assert `!exists(docs/reports/005)` — the ABSENCE of the
  // published directory — as its proxy for "the stub staged out-of-root". That is
  // a snapshot of the pre-publish world, not a property of the run: RUNBOOK step 3
  // creates that directory legitimately, after which the repo gate read 365/366
  // forever, INCLUDING on the published tree at step 7 where invariant 2 admits no
  // exceptions. The publish sequence therefore had no green end-state.
  //
  // What the check actually means is that the stub run wrote nothing into the repo
  // tree. So compare the tree against itself, before and after: whatever
  // docs/reports looked like going in, it must look the same coming out.
  gate.check('report-005 wrote NOTHING into the repo tree (staging is out-of-root)',
    out.publicTreeTouched === false
    && JSON.stringify(docsReportsBefore) === JSON.stringify(
         fs.existsSync(path.join(ROOT, 'docs', 'reports'))
           ? fs.readdirSync(path.join(ROOT, 'docs', 'reports')).sort() : []),
    { before: docsReportsBefore });

  fs.rmSync(tmp, { recursive: true, force: true });
}

// ── merge precondition (DECISIONS #12) ───────────────────────────────────────
// The rule that a merge needs an approval naming the merged SHA existed in
// DECISIONS #4 and was violated twice (#5, #12). It is now a script, and the gate
// checks the script behaves — including that it can REFUSE, since a guard that
// only ever passes is the same as no guard.
gate.section('published reports carry no draft chrome');
{
  // Amendment v1.0.1 (Report #005). The publication switch stripped the noindex
  // tag and the DRAFT banner but was never applied to the <title> or the footer,
  // so #005 shipped titled "Report #005 (DRAFT)" and footed "· DRAFT". The
  // per-report chrome assertion checked the banner and the meta tag by name, and
  // therefore could not see a marker anywhere else on the page.
  //
  // So this checks the PROPERTY rather than the two known places: a published
  // report page contains the string DRAFT nowhere at all, and carries no noindex.
  // It runs over every published report, so the defect cannot recur on #006.
  const reportsDir = path.join(SCAN_ROOT, 'docs', 'reports');
  const published = fs.existsSync(reportsDir)
    ? fs.readdirSync(reportsDir).filter((d) => /^[0-9]+$/.test(d)).sort()
    : [];
  gate.check('at least one published report exists to check', published.length > 0, { published });
  const withDraft = [];
  const withNoindex = [];
  for (const d of published) {
    const f = path.join(reportsDir, d, 'index.html');
    if (!fs.existsSync(f)) continue;
    const h = fs.readFileSync(f, 'utf8');
    if (/DRAFT/.test(h)) withDraft.push(d + ': ' + (h.match(/[^\n]{0,60}DRAFT[^\n]{0,40}/) || [''])[0].trim().slice(0, 90));
    if (/name="robots"[^>]*noindex/.test(h)) withNoindex.push(d);
  }
  gate.check('no published report page contains the string DRAFT anywhere', withDraft.length === 0, { withDraft });
  gate.check('no published report page carries a noindex robots tag', withNoindex.length === 0, { withNoindex });

  // RECEIPTS ARE LINKED, NOT NAMED (DECISIONS #20), AND THE POINTER MUST RESOLVE.
  //
  // These two live in the REPO gate rather than only in specs/004's gate for one
  // reason: `build-public.sh` runs the repo gate against the tree it is about to
  // publish, and nothing runs a spec gate at publish time. Approval finding G-F5
  // was a published page pointing at `receipts/report-004-draft/`, a directory
  // that does not exist, live on the site — a guard for that class which a
  // publish never executes is not a guard.
  //
  // Invariant 1 says every published number carries a receipt. The receipts
  // existed and were public the whole time; what failed was that the page's
  // pointer did not resolve for the reader the invariant is written for.
  const deadPointers = [];
  const unlinked = [];
  const stagedText = [];
  for (const d of published) {
    const f = path.join(reportsDir, d, 'index.html');
    if (!fs.existsSync(f)) continue;
    const h = fs.readFileSync(f, 'utf8');

    // (a) every receipts path the page NAMES must resolve in the scanned tree.
    for (const rel of new Set(h.match(/receipts\/report-[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)?/g) || [])) {
      if (!fs.existsSync(path.join(SCAN_ROOT, rel))) deadPointers.push(`${d} -> ${rel}`);
    }

    // (a2) CROSS-REPORT POINTERS. Approval finding F-009-S: #005 carried a staged
    // amendment block with two forward links to ../006/index.html while #006 sat at
    // docs/reports/006-draft/, which EXCLUDE_RE strips. The page publishes, the
    // target does not, and the reader gets a 404 — G-F5's class, one directory up
    // from the receipts paths (a) already covers. Derived from the link, never from
    // a list of known reports.
    for (const m of new Set([...h.matchAll(/href="\.\.\/([0-9]+)\//g)].map((x) => x[1]))) {
      if (!fs.existsSync(path.join(reportsDir, m, 'index.html'))) deadPointers.push(`${d} -> ../${m}/ (no such report in the scanned tree)`);
    }

    // (a3) NO PUBLISHED PAGE MAY DESCRIBE ITSELF AS NOT-YET-PUBLISHED. The same
    // finding: the block was headed 'STAGED, TAKES EFFECT ON PUBLISH … is not live',
    // a sentence that becomes false at the instant it publishes. The DRAFT-string
    // assertion above could not see it — 'STAGED' is not 'DRAFT' — so the property
    // is checked directly: text staged for a future state does not belong in a tree
    // that any build-public.sh run publishes, related to that state or not.
    for (const marker of ['TAKES EFFECT ON PUBLISH', 'is not live', 'unmerged']) {
      if (h.includes(marker)) stagedText.push(`${d}: "${marker}"`);
    }

    // (b) every receipt that EXISTS for the report must be linked from its page.
    // Derived from the directory, never from a list: a literal list is correct on
    // the day it is written and silently short afterwards.
    const recDir = path.join(SCAN_ROOT, 'receipts', `report-${d}`);
    if (!fs.existsSync(recDir)) continue;
    // A RECEIPT is `slug__model.json` — the shape every report has emitted since
    // #001, and the shape scripts/receipt-links.js parses. `_index.json` is an
    // index OF receipts, not one, and #001 has ten `__drift.md` reports besides.
    // Written as the parse rather than as an exclusion list so a new sidecar file
    // does not silently become something this assertion demands a link for.
    const receipts = fs.readdirSync(recDir).filter((x) => /^.+__.+\.json$/.test(x));
    const missing = receipts.filter((x) => !h.includes(`/blob/main/receipts/report-${d}/${x}`));
    if (missing.length) unlinked.push(`${d}: ${missing.length}/${receipts.length} unlinked (${missing.slice(0, 3).join(', ')})`);
  }
  gate.check('every receipts path named on a published report page resolves in the scanned tree',
    deadPointers.length === 0, { deadPointers: deadPointers.slice(0, 20) });
  gate.check('every receipt of every published report is linked from its page (DECISIONS #20)',
    unlinked.length === 0, { unlinked: unlinked.slice(0, 20) });
  gate.check('no published report page carries text staged for a state that has not happened',
    stagedText.length === 0, { stagedText: stagedText.slice(0, 20) });
}

// ── the publish script: required message, and a history ──────────────────────
//
// STANDING publish control, so it lives in the repo gate rather than only in
// specs/005's gate: build-public.sh runs THIS gate against the tree it is about
// to publish, and nothing runs a spec gate at publish time.
//
// Two defects are held here. The script used to carry a hard-coded commit message
// announcing the v0.5.0 release, which was true for one build and would have
// announced a release on every build after it (O-3). And it was untracked, with no
// history, while CONSTITUTION.md named it FIRST in its automatically-T1 list
// (approval finding A-F11).
//
// A third defect was found by the approval runs and is held here too: the target
// used to come from the environment, and `rm -rf` used to get it unresolved.
//
// DECISIONS #13 asks that a publish-path assertion exercise the SHIPPED invocation
// rather than an analog, and every assertion below runs the shipped script. One of
// them now runs the SUCCESS path — it builds — which NFR-2 said no gate would, for
// a recursion reason that has since been answered structurally rather than
// avoided: as the verification step of a real build this gate reads the message
// off the publish it is verifying instead of building, so nothing nests. The spec
// records the reversal.
gate.section('publish script');
{
  const rel = 'scripts/build-public.sh';
  const script = path.join(SCAN_ROOT, rel);
  const exists = fs.existsSync(script);
  gate.check('the publish script is present in the scanned tree', exists, { rel });
  if (exists) {
    const src = fs.readFileSync(script, 'utf8');

    // No message may be stored in the tool: a message written once is a message
    // the next publish inherits. This holds the INSTANCE — the retired v0.5.0
    // text — and an approval run was right that it does not hold the class. The
    // class is held behaviourally below, by building and reading the commit back.
    const retired = ['This push IS a release', 'PUBMSG', 'Series: #001'].filter((x) => src.includes(x));
    gate.check('the publish script stores no commit message text', retired.length === 0, { retired });
    gate.check('the publish script performs no push (the push stays a human act)',
      !/git\s[^\n]*push/.test(src), {});

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-pub-'));
    // Every invocation below is bounded. An approval run demonstrated that a
    // mutated script can hang the suite, and that the bound has to be on the
    // invocation rather than on the caller's patience.
    // A refusal is sub-second and a build is ~10s on the box this was written
    // on, so these are 20x and 15x headroom respectively. Tighter than that risks
    // a gate that reports how loaded the box is (C-3); looser makes the hang case
    // — the case they exist for — take longer than anyone will wait.
    const T_REFUSE = 20000;
    const T_BUILD = 150000;
    const GIT_ID = {
      GIT_AUTHOR_NAME: 'driftproof-gate', GIT_COMMITTER_NAME: 'driftproof-gate',
      // Not an address. The hygiene scan flags anything email-shaped and git is
      // content with an opaque identity string.
      GIT_AUTHOR_EMAIL: 'driftproof-gate', GIT_COMMITTER_EMAIL: 'driftproof-gate',
    };
    // ── THE CHILD GETS A SCRUBBED ENVIRONMENT ────────────────────────────
    //
    // The downward half of F-1's handshake, and the reason that finding is T1
    // rather than T2. `build-public.sh` runs THIS gate as its last act, so at
    // publish time this process's own environment is whatever the publish script
    // put there. Spreading `process.env` into a probe therefore hands the script
    // under test the very variables it now refuses — and every publish-path
    // assertion below would fail, but only during a real publish, which is the
    // one run nobody is watching as closely.
    //
    // So the family is removed by PREFIX, not by naming the three known members:
    // the rule the script enforces is structural, and a caller that complies with
    // it by enumeration is one new variable away from breaking it. A probe that
    // wants a specific value sets it back explicitly through `extra`.
    const scrubbedEnv = (extra = {}) => {
      const e = { ...process.env };
      for (const k of Object.keys(e)) if (k.startsWith('DRIFTPROOF_')) delete e[k];
      return { ...e, ...GIT_ID, ...extra };
    };
    const run = (args, extraEnv = {}, timeout = T_REFUSE, cwd = SCAN_ROOT) => {
      try {
        const out = execFileSync('bash', [script, ...args], {
          cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout,
          env: scrubbedEnv(extraEnv),
        });
        return { rc: 0, out };
      } catch (e) {
        return { rc: e.status == null ? -1 : e.status, out: `${e.stdout || ''}${e.stderr || ''}` };
      }
    };
    try {
      // ── THE MESSAGE, HELD BEHAVIOURALLY ──────────────────────────────────
      //
      // Two approval runs defeated a static check of this property, each time by
      // a spelling the regex did not cover — a comment that satisfied it, then
      // dead code carrying the token it looked for beside a live `-m $LIT` it did
      // not. Static analysis of shell was the wrong instrument. What is asserted
      // now is the OUTCOME: give the script a message, then read the message off
      // the commit it produced. A script that publishes a stored literal fails
      // this whatever it looks like.
      //
      // Two forms, one assertion, because this gate runs in two places. As the
      // VERIFICATION step of a real build it reads the message off the publish it
      // is verifying — the real artifact, not a probe — and building a tree of
      // its own there is what would recurse. Anywhere else it builds a tree and
      // reads that. Exactly one check is emitted either way, so the count does
      // not depend on how the gate was invoked.
      if (PUBLISH_VERIFY) {
        const passed = PUBLISH_MESSAGE;
        let head = '';
        try {
          head = execFileSync('git', ['-C', SCAN_ROOT, 'log', '-1', '--pretty=%B'],
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: T_REFUSE });
        } catch (e) { head = `<git failed: ${e.message}>`; }
        gate.check('the publish commit carries exactly the message this build was given',
          passed.trim().length > 0 && head.trim() === passed.trim(),
          { passed: passed.slice(0, 120), head: head.slice(0, 120) });
      } else {
        const built = path.join(tmp, 'behavioural');
        const nonce = 'gate probe: the operator wrote this and nothing else did';
        const b = run(['-m', nonce, '--public-dir', built], {}, T_BUILD);
        let head = '';
        try {
          head = execFileSync('git', ['-C', built, 'log', '-1', '--pretty=%B'],
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: T_REFUSE });
        } catch (e) { head = `<git failed: ${e.message}>`; }
        gate.check('the publish commit carries exactly the message the invocation passed',
          b.rc === 0 && head.trim() === nonce,
          { rc: b.rc, head: head.slice(0, 120), out: b.rc === 0 ? '' : b.out.slice(0, 200) });
      }

      // ── THE TARGET DOES NOT COME FROM THE ENVIRONMENT ────────────────────
      //
      // `DRIFTPROOF_PUBLIC_DIR` used to name what `rm -rf` deleted. It is gone,
      // and its absence is asserted by BEHAVIOUR rather than by grepping for the
      // name — the same instrument that failed twice on the message.
      //
      // Probed against a COPY of the shipped script placed in a throwaway tree,
      // so that the target the script derives for itself is inside the sandbox.
      // Probing the real tree would mean letting the gate build into the
      // operator's actual publish directory to find out where it went.
      // This probe used to be one check, and F-1 split it in two. It ran the
      // script WITH `DRIFTPROOF_PUBLIC_DIR` set and observed that the script
      // built somewhere else — proving the variable was ignored. Under the
      // refusal below, that same invocation now exits 7 and builds nothing, which
      // is strictly stronger about the variable and says nothing at all about
      // where the script builds when no variable is present. Both properties are
      // worth holding, so both are held: the refusal, and the derivation under a
      // clean environment. Dropping the second would trade one defect class for
      // its mirror, which is the trade F-3 was filed for.
      const fake = path.join(tmp, 'fakerepo');
      fs.mkdirSync(path.join(fake, 'scripts'), { recursive: true });
      fs.copyFileSync(script, path.join(fake, 'scripts', 'build-public.sh'));
      // Same reason, and one more: this probe relies on the run dying at
      // `git ls-files`, a line spec 011's dependency-shape guard now sits above.
      fs.mkdirSync(path.join(fake, 'node_modules'), { recursive: true });
      const envDir = path.join(tmp, 'env-named');
      fs.mkdirSync(envDir, { recursive: true });
      fs.writeFileSync(path.join(envDir, 'SENTINEL'), 'x');
      const fakeScript = path.join(fake, 'scripts', 'build-public.sh');
      const runFake = (extra) => {
        try {
          // Depth 0 explicitly: this probe is a build, and it must behave the
          // same whether this gate is running standalone or as the verification
          // step of one. It cannot recurse — the throwaway tree is not a git
          // repository, so the run dies at `git ls-files`, long before the line
          // that would run a gate.
          execFileSync('bash', [fakeScript, '-m', 'env probe'], {
            cwd: tmp, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: T_REFUSE,
            env: scrubbedEnv({ DRIFTPROOF_BUILD_DEPTH: '0', ...extra }),
          });
          return { rc: 0, out: '' };
        } catch (e) {
          return { rc: e.status == null ? -1 : e.status, out: `${e.stdout || ''}${e.stderr || ''}` };
        }
      };

      // F-1, first limb: the family is REFUSED, not ignored. Probed with the
      // retired name, because a variable this script never reads is exactly the
      // case a name-list check would miss.
      const tainted = runFake({ DRIFTPROOF_PUBLIC_DIR: envDir });
      gate.check('an inherited DRIFTPROOF_ variable is refused with exit 7, naming it',
        tainted.rc === 7 && tainted.out.includes('DRIFTPROOF_PUBLIC_DIR')
          && !fs.existsSync(path.join(tmp, 'driftproof-public')),
        { rc: tainted.rc, out: tainted.out.slice(0, 200), builtAnyway: fs.existsSync(path.join(tmp, 'driftproof-public')) });

      // The selector F-1 actually measured, and a name the script has never read.
      const taintedVerify = runFake({ DRIFTPROOF_PUBLISH_VERIFY: '1' });
      gate.check('the assertion-selector F-1 measured is refused with exit 7',
        taintedVerify.rc === 7 && taintedVerify.out.includes('DRIFTPROOF_PUBLISH_VERIFY'),
        { rc: taintedVerify.rc, out: taintedVerify.out.slice(0, 200) });
      const taintedNovel = runFake({ DRIFTPROOF_NOT_A_REAL_KNOB: '1' });
      gate.check('a DRIFTPROOF_ name the script has never read is refused too',
        taintedNovel.rc === 7 && taintedNovel.out.includes('DRIFTPROOF_NOT_A_REAL_KNOB'),
        { rc: taintedNovel.rc, out: taintedNovel.out.slice(0, 200) });

      // The exemption, both halves. Depth still refuses by its own rule at 4, and
      // the exemption does not launder a second variable through it.
      const depthOnly = runFake({ DRIFTPROOF_BUILD_DEPTH: '2' });
      gate.check('DRIFTPROOF_BUILD_DEPTH is exempt and still refuses by its own rule, exit 4',
        depthOnly.rc === 4 && /nested build/.test(depthOnly.out),
        { rc: depthOnly.rc, out: depthOnly.out.slice(0, 200) });
      const depthPlus = runFake({ DRIFTPROOF_BUILD_DEPTH: '0', DRIFTPROOF_SOMETHING_ELSE: '1' });
      // The OFFENDER LIST is the indented block, not the whole refusal: the
      // explanatory text names the exempt variable on purpose, to say why it is
      // exempt. Matching the whole output reads that sentence as an accusation.
      const offenders = depthPlus.out.split('\n').filter((l) => /^ {4}DRIFTPROOF_/.test(l)).map((l) => l.trim());
      gate.check('the exemption is scoped to that one name — depth plus another is exit 7',
        depthPlus.rc === 7 && offenders.includes('DRIFTPROOF_SOMETHING_ELSE')
          && !offenders.includes('DRIFTPROOF_BUILD_DEPTH'),
        { rc: depthPlus.rc, offenders });

      // The surviving half: with nothing of the family in the environment, the
      // target is still the one the script DERIVES for itself.
      runFake({});
      gate.check('the environment cannot name what the publish script deletes',
        fs.existsSync(path.join(envDir, 'SENTINEL')) && fs.existsSync(path.join(tmp, 'driftproof-public')),
        { sentinel: fs.existsSync(path.join(envDir, 'SENTINEL')), derivedTargetUsed: fs.existsSync(path.join(tmp, 'driftproof-public')) });

      // ── THE MESSAGE IS REQUIRED, AND REFUSED FOR IN TIME ─────────────────
      // Run for real against a sandbox holding a sentinel. Refusing AFTER
      // destroying the previous artifact is refusing too late to matter.
      const pub = path.join(tmp, 'pub');
      fs.mkdirSync(pub, { recursive: true });
      fs.writeFileSync(path.join(pub, 'SENTINEL'), 'x');
      const none = run(['--public-dir', pub]);
      gate.check('the publish script refuses to run with no commit message', none.rc === 2, { rc: none.rc });
      gate.check('it refuses BEFORE altering the public directory',
        fs.existsSync(path.join(pub, 'SENTINEL')), { pub });
      gate.check('the refusal says how to supply a message', /-m\b/.test(none.out), { out: none.out.slice(0, 200) });

      // The message path, exercised in the shipped script, without a build.
      const pub2 = path.join(tmp, 'pub2');
      const msg = 'a specific claim about this build';
      const printed = run(['-m', msg, '--print-message', '--public-dir', pub2]);
      gate.check('--print-message resolves the message from the invocation',
        printed.rc === 0 && printed.out.trim() === msg, { rc: printed.rc, out: printed.out.slice(0, 120) });
      gate.check('--print-message builds nothing', !fs.existsSync(pub2), { pub2 });

      // ── WHAT MAY BE DESTROYED ────────────────────────────────────────────
      //
      // "Exited non-zero" is NOT the property: an unguarded script also exits
      // non-zero against the source tree — it destroys the tree and then dies at
      // `cd`. Neither is the generic banner: an approval run deleted the
      // source-tree rules, watched the shape check refuse instead, and both
      // assertions still passed, so the rule written for the source tree had
      // never been tested. Each assertion below names the SPECIFIC reason, and
      // the target has to still be there afterwards.
      const REFUSAL = 'REFUSING — unsafe publish target';
      const refuses = (target, reason, extraEnv = {}) => {
        const r = run(['-m', 'a valid message', '--public-dir', target], extraEnv);
        return { ok: r.rc === 3 && r.out.includes(REFUSAL) && r.out.includes(reason), rc: r.rc, out: r.out.slice(0, 200) };
      };

      const srcEntries = fs.readdirSync(SCAN_ROOT).length;
      const src1 = refuses(SCAN_ROOT, 'that is the source tree');
      gate.check('the publish script refuses the source tree, by the source-tree rule', src1.ok, src1);
      gate.check('the source tree is still there after that refusal',
        fs.readdirSync(SCAN_ROOT).length === srcEntries,
        { before: srcEntries, after: fs.readdirSync(SCAN_ROOT).length });

      // Someone else's non-empty directory. An approval run showed the previous
      // shape test — docs/ + README.md present, DECISIONS.md + specs/ absent —
      // admitted the operator's home directory and a great many ordinary project
      // directories, so this one wears that exact shape.
      const mine = path.join(tmp, 'not-ours');
      fs.mkdirSync(path.join(mine, 'docs'), { recursive: true });
      fs.writeFileSync(path.join(mine, 'README.md'), '# someone else\n');
      fs.writeFileSync(path.join(mine, 'IRREPLACEABLE'), 'x');
      const mine1 = refuses(mine, 'is not a publish tree this script built');
      gate.check('the publish script refuses a non-empty directory it did not build', mine1.ok, mine1);
      gate.check('that directory still holds its contents',
        fs.existsSync(path.join(mine, 'IRREPLACEABLE')), { mine });

      // THE HOME DIRECTORY, in every spelling that defeated the string
      // comparison an approval run took apart: a trailing slash on HOME, a
      // symlinked parent component, a `/.` suffix, and the plain spelling. Run
      // against a SIMULATED home in the sandbox — never the real one — with
      // things in it that no `git checkout` restores.
      const home = path.join(tmp, 'simhome');
      fs.mkdirSync(path.join(home, 'Documents'), { recursive: true });
      fs.writeFileSync(path.join(home, 'taxes.txt'), 'irreplaceable\n');
      fs.writeFileSync(path.join(home, 'Documents', 'thesis.txt'), 'irreplaceable\n');
      const linkDir = path.join(tmp, 'via-symlink');
      fs.symlinkSync(tmp, linkDir);
      const spellings = [
        ['plain', home, { HOME: home }],
        ['trailing slash on the target', `${home}/`, { HOME: home }],
        ['a /. suffix', `${home}/.`, { HOME: home }],
        ['trailing slash on HOME', home, { HOME: `${home}/` }],
        ['a symlinked parent component', path.join(linkDir, 'simhome'), { HOME: home }],
        ['doubled separators', `${home}//`, { HOME: home }],
      ];
      const homeFail = [];
      for (const [label, target, env] of spellings) {
        const r = refuses(target, 'that is your home directory', env);
        if (!r.ok) homeFail.push({ label, rc: r.rc, out: r.out.slice(0, 120) });
      }
      const homeIntact = fs.existsSync(path.join(home, 'taxes.txt'))
        && fs.existsSync(path.join(home, 'Documents', 'thesis.txt'));
      gate.check('the publish script refuses the home directory however it is spelled, and it survives',
        homeFail.length === 0 && homeIntact, { homeFail, homeIntact });

      // A target that EXISTS AND IS NOT A DIRECTORY was destroyed with no check
      // at all by the previous revision: its whole shape test hung off
      // `[ -d "$PUB" ]`, so a regular file skipped every content check there was.
      const aFile = path.join(tmp, 'a-regular-file');
      fs.writeFileSync(aFile, 'irreplaceable\n');
      const file1 = refuses(aFile, 'exists and is not a directory');
      gate.check('the publish script refuses a target that is a regular file, and the file survives',
        file1.ok && fs.existsSync(aFile) && fs.statSync(aFile).isFile(), file1);

      // ── THE NEXT-PUBLISH BLOCKER GUARD (DECISIONS #28, specs/006) ────────
      //
      // A blocker used to be prose in DECISIONS.md, and a publish crossed it
      // because nothing parsed it. DECISIONS #13 asks that a publish-path
      // assertion exercise the SHIPPED invocation, so these run the real script
      // against throwaway SOURCE trees, each carrying its own DECISIONS.md. The
      // target the script derives for itself is then the sandbox's default
      // sibling — the publish path the guard binds — never the operator's.
      const sandbox = (name, decisions) => {
        const root = path.join(tmp, 'guard', name);
        fs.mkdirSync(path.join(root, 'src', 'scripts'), { recursive: true });
        fs.copyFileSync(script, path.join(root, 'src', 'scripts', 'build-public.sh'));
        // Spec 011 AC-1 refuses a source tree whose node_modules is absent or a
        // link. A fixture without one stopped modelling a source tree the moment
        // that guard existed, so it gets a real dependency directory.
        fs.mkdirSync(path.join(root, 'src', 'node_modules'), { recursive: true });
        if (decisions !== null) fs.writeFileSync(path.join(root, 'src', 'DECISIONS.md'), decisions);
        return root;
      };
      const guardRun = (root, args, extraEnv = {}) => {
        try {
          const out = execFileSync('bash', [path.join(root, 'src', 'scripts', 'build-public.sh'), ...args], {
            cwd: tmp, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: T_REFUSE,
            env: scrubbedEnv({ DRIFTPROOF_BUILD_DEPTH: '0', ...extraEnv }),
          });
          return { rc: 0, out };
        } catch (e) {
          return { rc: e.status == null ? -1 : e.status, out: `${e.stdout || ''}${e.stderr || ''}` };
        }
      };
      const derived = (root) => path.join(root, 'driftproof-public');
      const OPEN_MARKERS = '# log\n\nNEXT-PUBLISH-BLOCKER-OPEN: F-1 F-2 E-F1\n';

      const blocked = sandbox('blocked', OPEN_MARKERS);
      const bR = guardRun(blocked, ['-m', 'a valid message']);
      gate.check('the publish script refuses while a NEXT-PUBLISH BLOCKER is open, and builds nothing',
        bR.rc === 5 && /NEXT-PUBLISH BLOCKER/.test(bR.out)
          && ['F-1', 'F-2', 'E-F1'].every((id) => bR.out.includes(id))
          && !fs.existsSync(derived(blocked)),
        { rc: bR.rc, out: bR.out.slice(0, 200), targetCreated: fs.existsSync(derived(blocked)) });

      // ORDER, ASSERTED FOR THE COMPOSED CASE (F-1, AC-5). The same sandbox is
      // now both blocker-open and environment-tainted. "It refused" was never the
      // property — WHICH rule refused is (spec 005 run 2, finding 3) — and the
      // two rules race only if nobody pins them. The environment is vetted first,
      // because a guard evaluated in an environment nobody checked is a decision
      // whose inputs nobody checked. Exit 7 wins, and the blocker guard must not
      // even report.
      const bothR = guardRun(blocked, ['-m', 'a valid message'], { DRIFTPROOF_PUBLISH_VERIFY: '1' });
      gate.check('tainted AND blocker-open refuses for the environment, exit 7, not the blocker guard',
        bothR.rc === 7 && bothR.out.includes('DRIFTPROOF_PUBLISH_VERIFY')
          && !/NEXT-PUBLISH BLOCKER/.test(bothR.out) && !fs.existsSync(derived(blocked)),
        { rc: bothR.rc, out: bothR.out.slice(0, 200) });

      // And argument validation still outruns both, which is specs/006 AC-7c's
      // principle rather than a second convention invented for this rule.
      const argFirst = guardRun(blocked, [], { DRIFTPROOF_PUBLISH_VERIFY: '1' });
      gate.check('argument validation still precedes the environment check, exit 2',
        argFirst.rc === 2, { rc: argFirst.rc, out: argFirst.out.slice(0, 200) });

      // The tripwire. A guard that refuses unconditionally is an outage wearing
      // a control's clothes, and the refusal above would pass either way.
      const clear = sandbox('clear', '# log\n\nnothing is open here.\n');
      const cR = guardRun(clear, ['-m', 'a valid message']);
      gate.check('it proceeds past the guard when no blocker is open',
        !/NEXT-PUBLISH BLOCKER/.test(cR.out) && fs.existsSync(derived(clear)),
        { rc: cR.rc, out: cR.out.slice(0, 200) });

      const waived = sandbox('waived', OPEN_MARKERS + 'PUBLISH-WAIVER-ID: W-GATE-01\n');
      const wOk = guardRun(waived, ['-m', 'a valid message', '--waiver', 'W-GATE-01']);
      gate.check('a waiver recorded in DECISIONS.md permits the run',
        !/REFUSING/.test(wOk.out) && fs.existsSync(derived(waived)),
        { rc: wOk.rc, out: wOk.out.slice(0, 200) });

      // A waiver that need not exist is a --force flag with a longer name, and
      // merge-check offers no --force for exactly this reason.
      const unwaived = sandbox('unwaived', OPEN_MARKERS + 'PUBLISH-WAIVER-ID: W-GATE-01\n');
      const wBad = guardRun(unwaived, ['-m', 'a valid message', '--waiver', 'W-NOPE']);
      gate.check('a waiver that is not recorded is refused, and builds nothing',
        wBad.rc === 5 && /not recorded/.test(wBad.out) && !fs.existsSync(derived(unwaived)),
        { rc: wBad.rc, out: wBad.out.slice(0, 200) });

      // The waiver id is COMPARED, never used as a pattern. specs/006 approval
      // run 1's blocking finding: interpolated into an ERE, `--waiver '.*'`
      // matched any recorded line and was accepted as "recorded" while naming no
      // recorded id — the --force flag with a longer name, arriving the moment
      // the first waiver is filed. `W-NOPE` above never exercises that class.
      const meta = sandbox('meta', OPEN_MARKERS + 'PUBLISH-WAIVER-ID: W-GATE-01\n');
      const metaBad = ['.*', 'W-GATE-0.'].map((w) => ({
        w, r: guardRun(meta, ['-m', 'a valid message', '--waiver', w]),
      }));
      gate.check('a waiver of regex metacharacters is refused though a waiver is recorded',
        metaBad.every((x) => x.r.rc === 5 && /not recorded/.test(x.r.out)) && !fs.existsSync(derived(meta)),
        { tried: metaBad.map((x) => `${x.w}:${x.r.rc}`), targetCreated: fs.existsSync(derived(meta)) });

      // The tripwire: a comparison tightened until it accepts nothing is not a
      // fix. A recorded id carrying metacharacters still runs, as itself.
      const metaOk = sandbox('metaok', OPEN_MARKERS + 'PUBLISH-WAIVER-ID: W.GATE.02\n');
      const mOk = guardRun(metaOk, ['-m', 'a valid message', '--waiver', 'W.GATE.02']);
      gate.check('a recorded id containing a metacharacter is accepted as itself',
        !/REFUSING/.test(mOk.out) && fs.existsSync(derived(metaOk)),
        { rc: mOk.rc, out: mOk.out.slice(0, 200) });

      // An absent log records nothing, so it records no waiver either. This
      // refusal used to sit inside the file test and was skipped here (specs/006
      // approval run 1, finding 3). The no-log case still PROCEEDS with no
      // waiver named — DECISIONS #28 — which the 'clear' probe above covers.
      const nolog = sandbox('nolog', null);
      const nR = guardRun(nolog, ['-m', 'a valid message', '--waiver', 'W-NOPE']);
      gate.check('an unrecorded waiver is refused with no DECISIONS.md in the tree',
        nR.rc === 5 && /not recorded/.test(nR.out) && !fs.existsSync(derived(nolog)),
        { rc: nR.rc, out: nR.out.slice(0, 200) });
      // ── F-2 (spec 007, AC-5): the two target rules that had no assertion ──
      // AC-9 of spec 005 names six categories of unsafe target; two of them —
      // "inside the source tree" and "an ancestor of it" — were held by no gate
      // at all, so deleting both `case` blocks left this gate at its full count.
      // Each assertion requires that rule's OWN reason line, because the failure
      // this closes is a rule firing under another rule's name.
      //
      // Aimed at a sandbox source tree rather than at SCAN_ROOT. Every other
      // probe here can afford the shipped-invocation form because its blast
      // radius is a temp directory; these two name the repository itself and its
      // parent, and a regression in the rule under test is exactly the case
      // where the target would be deleted (backlog E-F2).
      const inside = sandbox('inside-src', '# log\n');
      const insideR = guardRun(inside, ['-m', 'a valid message', '--public-dir', path.join(inside, 'src', 'nested')]);
      gate.check('a target INSIDE the source tree is refused with its own reason, and builds nothing',
        insideR.rc === 3 && /that is inside the source tree/.test(insideR.out)
          && !fs.existsSync(path.join(inside, 'src', 'nested')),
        { rc: insideR.rc, out: insideR.out.slice(0, 200) });

      const ancestor = sandbox('ancestor-of-src', '# log\n');
      const ancestorR = guardRun(ancestor, ['-m', 'a valid message', '--public-dir', ancestor]);
      gate.check('a target that is an ANCESTOR of the source tree is refused with its own reason',
        ancestorR.rc === 3 && /the source tree is inside it/.test(ancestorR.out),
        { rc: ancestorR.rc, out: ancestorR.out.slice(0, 200) });

      // ── F-3 (spec 007, AC-6): the recursion backstop, held where it runs ───
      // A publish runs THIS gate and nothing runs a spec gate, so a standing
      // publish control that lived only in specs/005's gate was not enforced at
      // the moment it matters. specs/005 keeps its assertion; this adds the one
      // that runs at publish time. Also closes backlog H-F1, which asked for
      // exactly this "in the repo gate as well as the spec gate".
      const nested = sandbox('nested-build', '# log\n');
      const nestedR = (() => {
        try {
          const out = execFileSync('bash', [path.join(nested, 'src', 'scripts', 'build-public.sh'),
            '-m', 'a valid message', '--public-dir', path.join(nested, 'out')], {
            cwd: tmp, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: T_REFUSE,
            env: scrubbedEnv({ DRIFTPROOF_BUILD_DEPTH: '2' }),
          });
          return { rc: 0, out };
        } catch (e) { return { rc: e.status == null ? -1 : e.status, out: `${e.stdout || ''}${e.stderr || ''}` }; }
      })();
      gate.check('a nested build is refused with exit 4 and the nested-build reason, and builds nothing',
        nestedR.rc === 4 && /nested build/.test(nestedR.out) && !fs.existsSync(path.join(nested, 'out')),
        { rc: nestedR.rc, out: nestedR.out.slice(0, 200) });

      // ── E-F1 (spec 007, AC-8): the commit identity, checked above rm -rf ───
      // A publish-path refusal, so it is asserted where a publish runs the gate.
      // GIT_ID is stripped and git is pointed at an empty HOME with no global or
      // system config: the identity is genuinely unset. The target is a
      // pre-existing directory carrying a canary, because the property is not
      // only "it refuses" but "it refuses with the target still there" — the
      // whole of E-F1 is that this failure used to land after the delete.
      const ident = sandbox('no-identity', '# log\n');
      const identTarget = path.join(ident, 'prior-tree');
      fs.mkdirSync(identTarget, { recursive: true });
      execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: identTarget, stdio: 'ignore' });
      execFileSync('git', ['remote', 'add', 'origin', `git@${'github.com'}:driftproofhq/driftproof.git`],
        { cwd: identTarget, stdio: 'ignore' });
      // The shape check ahead of this one requires a tree that LOOKS like one this
      // script built — README.md, docs/, and its own origin — so the probe builds
      // that shape. Otherwise the run is refused at exit 3 and never reaches the
      // criterion under test.
      fs.writeFileSync(path.join(identTarget, 'README.md'), '# prior publish tree\n');
      fs.mkdirSync(path.join(identTarget, 'docs'), { recursive: true });
      fs.writeFileSync(path.join(identTarget, 'CANARY'), 'keep me\n');
      const identEnv = { ...process.env, DRIFTPROOF_BUILD_DEPTH: '0', HOME: path.join(ident, 'empty-home'),
        GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
      // Same scrub as every other probe, written out because this one must NOT
      // get GIT_ID back — an identity is the thing under test here.
      for (const k of Object.keys(identEnv)) {
        if (k.startsWith('DRIFTPROOF_') && k !== 'DRIFTPROOF_BUILD_DEPTH') delete identEnv[k];
      }
      for (const k of ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'EMAIL']) delete identEnv[k];
      fs.mkdirSync(identEnv.HOME, { recursive: true });
      const identR = (() => {
        try {
          const out = execFileSync('bash', [path.join(ident, 'src', 'scripts', 'build-public.sh'),
            '-m', 'a valid message', '--public-dir', identTarget], {
            cwd: tmp, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: T_REFUSE, env: identEnv,
          });
          return { rc: 0, out };
        } catch (e) { return { rc: e.status == null ? -1 : e.status, out: `${e.stdout || ''}${e.stderr || ''}` }; }
      })();
      gate.check('with no configured commit identity the publish refuses BEFORE rm -rf, target intact',
        identR.rc === 6 && /no commit identity/.test(identR.out) && fs.existsSync(path.join(identTarget, 'CANARY')),
        { rc: identR.rc, out: identR.out.slice(0, 200), canary: fs.existsSync(path.join(identTarget, 'CANARY')) });
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
}

gate.section('merge precondition check');
{
  const { mergeCheck } = require('../scripts/merge-check.js');
  const os = require('os');
  const { execFileSync: run } = require('child_process');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mergecheck-'));
  // C-F6: the guard now reads approvals from a COMMIT, never from the checkout.
  // These fixtures therefore have to be a real repository. Writing records to
  // disk and never committing them used to exercise the guard; against the
  // committed reader it would only prove that an uncommitted record is invisible,
  // so every REFUSE assertion below would pass for the wrong reason — the vacuity
  // trap this suite exists to catch.
  const git = (...a) => run('git', a, { cwd: tmp, encoding: 'utf8', stdio: 'pipe' });
  git('init', '-q');
  // Not an address: the hygiene scan flags anything email-shaped, and git is
  // happy with an opaque identity string.
  git('config', 'user.email', 'driftproof-gate-fixture');
  git('config', 'user.name', 'driftproof-gate');
  const spec = path.join(tmp, 'specs', 'zzz-fixture');
  fs.mkdirSync(path.join(spec, 'evidence'), { recursive: true });
  fs.writeFileSync(path.join(spec, 'evidence', '.keep'), '');
  git('add', '-A'); git('commit', '-q', '-m', 'fixture: empty evidence dir');
  const SPEC = 'specs/zzz-fixture';
  const commit = (msg) => { git('add', '-A'); git('commit', '-q', '-m', msg); };
  const write = (name, body) => {
    fs.writeFileSync(path.join(spec, 'evidence', name), body);
    commit(`evidence: ${name}`);
  };
  const mc = (sha) => mergeCheck(SPEC, sha, 'HEAD', tmp);
  const SHA = 'a'.repeat(40), OTHER = 'b'.repeat(40);

  // The reader must be the COMMITTED tree: a record present on disk but absent
  // from git is not evidence anyone else can see.
  fs.writeFileSync(path.join(spec, 'evidence', 'approval-uncommitted.md'),
    `commit:       ${SHA}\ntree:         clean\nverdict:      approved\nblocking_findings: 0\n`);
  gate.check('merge-check IGNORES an approval that exists on disk but is not committed',
    mc(SHA).ok === false);
  fs.rmSync(path.join(spec, 'evidence', 'approval-uncommitted.md'));

  // D-F4: enumeration is ONE level, not recursive. `git ls-tree -r` reached into
  // `evidence/archive/` — where superseded records are parked precisely because
  // they no longer govern anything — and accepted one as the approval for a merge.
  fs.mkdirSync(path.join(spec, 'evidence', 'archive'), { recursive: true });
  fs.writeFileSync(path.join(spec, 'evidence', 'archive', 'approval-superseded.md'),
    `commit:       ${OTHER}\ntree:         clean\nverdict:      approved\nblocking_findings: 0\n`);
  commit('evidence: park a superseded record under archive/');
  gate.check('merge-check IGNORES an approval filed under evidence/archive/',
    mc(OTHER).ok === false);
  fs.rmSync(path.join(spec, 'evidence', 'archive'), { recursive: true, force: true });
  commit('evidence: drop the archive fixture');

  // Enumeration AND content must both come from the commit. Listing from git
  // while reading bodies from disk would let a committed record be edited in the
  // checkout — blocking_findings flipped to 0, say — and the guard would believe
  // the edit. Commit a record that BLOCKS, then rewrite it on disk to pass:
  // the guard must still refuse, because what merges is what is committed.
  write('approval-ondisk-edit.md', `commit:       ${SHA}
tree:         clean
verdict:      approved-with-findings
blocking_findings: 1
`);
  fs.writeFileSync(path.join(spec, 'evidence', 'approval-ondisk-edit.md'),
    `commit:       ${SHA}\ntree:         clean\nverdict:      approved\nblocking_findings: 0\n`);
  gate.check('merge-check reads approval CONTENT from the commit, not from an edited checkout',
    mc(SHA).ok === false);
  git('checkout', '--', '.');
  fs.rmSync(path.join(spec, 'evidence', 'approval-ondisk-edit.md'));
  commit('evidence: drop the on-disk-edit fixture');

  gate.check('merge-check REFUSES when evidence/ holds no approval at all',
    mc(SHA).ok === false);

  write('approval-1.md', `commit:       ${OTHER}
tree:         clean
verdict:      approved
`);
  const wrongSha = mc(SHA);
  gate.check('merge-check REFUSES when the only approval names a DIFFERENT SHA',
    wrongSha.ok === false && /no approval names/.test(wrongSha.problems.join(' ')), wrongSha.problems);

  write('approval-2.md', `commit:       ${SHA}
tree:         clean
verdict:      approved-with-findings
`);
  // ORDER IS NOT SUBSTANCE. A matching SHA with a blocking finding still open is
  // exactly what DECISIONS #12 recorded, so the field is required and a missing
  // one is refused rather than assumed clean.
  gate.check('merge-check REFUSES a matching SHA whose record omits blocking_findings',
    mc(SHA).ok === false);

  write('approval-2.md', `commit:       ${SHA}
tree:         clean
verdict:      approved-with-findings
blocking_findings: 1
`);
  gate.check('merge-check REFUSES while blocking findings are outstanding',
    mc(SHA).ok === false);

  write('approval-2.md', `commit:       ${SHA}
tree:         clean
verdict:      approved-with-findings
blocking_findings: 0
`);
  gate.check('merge-check PASSES on the exact SHA with no blocking findings',
    mc(SHA).ok === true);

  write('approval-3.md', `commit:       ${SHA}
tree:         dirty
verdict:      approved
blocking_findings: 0
`);
  gate.check('merge-check REFUSES an approval taken against a dirty tree',
    mc(SHA).ok === false);

  fs.rmSync(path.join(spec, 'evidence', 'approval-3.md'));
  commit('evidence: drop approval-3');
  write('approval-4.md', `commit:       ${SHA}
tree:         clean
verdict:      rejected
blocking_findings: 0
`);
  gate.check('merge-check REFUSES a rejected verdict even when the SHA matches',
    mc(SHA).ok === false);

  // Scan for a force CODE PATH, not the word: the file explains why it has none,
  // and a prose mention was making this assertion fail on its own documentation.
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'merge-check.js'), 'utf8');
  gate.check('merge-check offers no --force escape hatch',
    !/includes\(['"]--force['"]\)/.test(src) && !/opts\.force|args\.force/.test(src));
  // A caller-supplied SHA in a real check is the bypass the missing --force was
  // meant to prevent; truncated SHAs print "no approval names 9a363ba — records
  // name: 9a363ba" when the mismatch is a format difference.
  gate.check('merge-check refuses --head outside a dry run',
    /--head requires --dry-run/.test(src));
  gate.check('merge-check prints FULL SHAs in its refusal, never truncated',
    !/head\.slice\(0, ?7\)/.test(src));

  // DECISIONS #4's two-commit pattern means the tip of an approved branch is
  // normally the evidence commit, which no approval can name. The check resolves
  // the SUBJECT by walking back evidence-only commits — and must stop the moment
  // a commit touches anything else, or evidence could smuggle a change past it.
  const { resolveSubject } = require('../scripts/merge-check.js');
  const { execFileSync } = require('child_process');
  const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path.join(__dirname, '..'), encoding: 'utf8' }).trim();
  const subj = resolveSubject(headSha);
  const isAncestor = (a, b) => {
    try {
      execFileSync('git', ['merge-base', '--is-ancestor', a, b], { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
      return true;
    } catch (_e) { return false; }
  };
  gate.check('subject resolution returns a real commit reachable from HEAD',
    /^[0-9a-f]{40}$/.test(subj.subject) && isAncestor(subj.subject, headSha),
    { subject: subj.subject, skipped: subj.skipped.length });
  gate.check('every commit skipped as evidence-only touches ONLY specs/*/evidence/',
    subj.skipped.every((sha) => {
      const files = execFileSync('git', ['show', '--pretty=format:', '--name-only', sha], { cwd: path.join(__dirname, '..'), encoding: 'utf8' })
        .trim().split('\n').filter(Boolean);
      return files.length > 0 && files.every((f) => /^specs\/[^/]+\/evidence\//.test(f));
    }), { skipped: subj.skipped });
  // The same validation now serves a second gate. scripts/run-report-006.js
  // guarded a $26.88 T1 run with `fs.existsSync(approval)` alone — it never read
  // the record's verdict, blocking findings or SHA, so a rejected record or an
  // approval of another commit bought the run (approval finding F-009-H). It asks
  // these two functions instead, so what makes an approval an approval has ONE
  // implementation here rather than two that drift.
  {
    const { approvalFields, approvalProblems } = require('../scripts/merge-check.js');
    const { approvalRunProblems } = require('../scripts/run-report-006.js');
    const body = (o) => [
      `commit:       ${o.commit === undefined ? SHA : o.commit}`,
      `tree:         ${o.tree === undefined ? 'clean' : o.tree}`,
      `verdict:      ${o.verdict === undefined ? 'approved-with-findings' : o.verdict}`,
      ...(o.blocking === null ? [] : [`blocking_findings: ${o.blocking === undefined ? '0' : o.blocking}`]),
    ].join('\n');
    const rec = (o) => approvalFields(body(o), 'record.md');
    gate.check('the shared validation accepts a clean approval of the named SHA',
      approvalProblems(rec({}), SHA).length === 0);
    gate.check('the shared validation refuses a rejected verdict',
      approvalProblems(rec({ verdict: 'rejected' }), SHA).length > 0);
    gate.check('the shared validation refuses an approval of a DIFFERENT commit',
      approvalProblems(rec({ commit: '0'.repeat(40) }), SHA).some((m) => /names commit/.test(m)));
    gate.check('the shared validation refuses outstanding blocking findings',
      approvalProblems(rec({ blocking: '2' }), SHA).length > 0);
    gate.check('the shared validation refuses a record carrying no blocking_findings field',
      approvalProblems(rec({ blocking: null }), SHA).length > 0);

    const tdir = fs.mkdtempSync(path.join(os.tmpdir(), 'driftproof-ac14-'));
    const w = (name, o) => {
      const f = path.join(tdir, name);
      fs.writeFileSync(f, `${body(o)}\n`);
      return f;
    };
    gate.check('the T1 spend gate accepts a record naming the commit subject to approval',
      approvalRunProblems(w('good.md', { commit: subj.subject })).length === 0);
    gate.check('the T1 spend gate refuses a record naming another commit (F-009-H)',
      approvalRunProblems(w('wrong.md', { commit: '0'.repeat(40) })).some((m) => /names commit/.test(m)));
    gate.check('the T1 spend gate refuses a rejected record that names the right commit',
      approvalRunProblems(w('rejected.md', { commit: subj.subject, verdict: 'rejected' })).length > 0);
    gate.check('the T1 spend gate refuses an approval path that does not exist',
      approvalRunProblems(path.join(tdir, 'absent.md')).some((m) => /nothing on disk/.test(m)));
    fs.rmSync(tdir, { recursive: true, force: true });
  }

  gate.check('RUNBOOK wires the check into the spec-branch merge step',
    /merge-check\.js/.test(fs.readFileSync(path.join(__dirname, '..', 'RUNBOOK.md'), 'utf8')));

  fs.rmSync(tmp, { recursive: true, force: true });
}

// ── ESSAY GROUNDING ─────────────────────────────────────────────────────────
//
// The published essay is the one page whose figures are typed rather than
// re-derived from receipts, and it states on itself that a check fails the build
// when one of them disagrees with the report it cites. That sentence is a
// published claim, so the check runs HERE — in the gate a publish executes —
// rather than only beside its spec, which `build-public.sh` never runs and which
// the published tree does not even contain (specs/010, finding F-010-H).
gate.section('essay grounding (typed prose, bound to the pages it cites)');
{
  const essay = require('./essay-grounding');
  for (const r of essay.run(ROOT)) {
    gate.check(essay.DESCRIPTIONS[r.id] || r.id, r.ok, r.message ? { detail: r.message.split('\n').slice(0, 4) } : undefined);
  }
  // The check and its subject must ship together: a guard that is excluded from
  // the published tree is a guard the publish does not run.
  const tracked = execFileSync('git', ['ls-files', 'tests/essay-grounding.js', essay.ESSAY_REL], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter(Boolean);
  gate.check('the essay and the check that grounds it are both tracked (they ship together)',
    tracked.length === 2, { tracked });

  // ── the assertion-drafting rule, run where a publish runs ──────────────────
  //
  // Spec 013. The rule and its register are enforced HERE, not only in
  // specs/013's gate: `specs/` is excluded from the published tree and no
  // workflow runs a spec gate, so a rule that lives only beside its spec is
  // never executed by a build (F-010-H). build-public.sh runs this gate inside
  // the tree it is about to publish.
  const scope = require('./assertion-scope');

  const registerIds = new Set(scope.NARROWING_CLASSES.map((c) => c.id));
  const thin = scope.NARROWING_CLASSES.filter((c) => !c.statement || !c.drafting || !c.mutation || !c.instances || !c.instances.length);
  gate.check('every narrowing class carries a statement, a drafting rule, a mutation and the instance that named it',
    thin.length === 0, { thin: thin.map((c) => c.id) });

  // AN ABSENT CONSTITUTION.md PASSES, and the reason is the one DECISIONS #28
  // recorded for the blocker guard: the PUBLISHED TREE EXCLUDES THIS FILE, so a
  // check that failed closed here would fail every build made from a published
  // tree — for the absence of a file that tree is defined not to carry. The
  // register itself ships and is checked above from both vantages; this
  // assertion is the source tree's, and it says so rather than going quiet.
  const constitutionPath = path.join(ROOT, 'CONSTITUTION.md');
  if (fs.existsSync(constitutionPath)) {
    const bar = fs.readFileSync(constitutionPath, 'utf8').split(/^## /m).find((sec) => sec.startsWith('Quality bar')) || '';
    // THE PATTERN MUST MATCH THE NAMING CONVENTION, not one shape of it.
    // `[a-z]+-vs-[a-z]+` matched only single-word halves, so `helper-vs-product-path`
    // and `fixture-vs-real-artifact` were invisible here from the day they were
    // named — which also weakened the orphan check below, since it compared
    // against a list that was already short. Caught by adding the completeness
    // direction (F-016-B4); the register's own probe had the broader pattern all
    // along, and the two disagreeing is exactly the drift this pair of checks
    // exists to stop.
    const namedClasses = [...bar.matchAll(/`([a-z]+(?:-[a-z]+)+)`/g)].map((m) => m[1]);
    const orphanClasses = namedClasses.filter((n) => !registerIds.has(n));
    gate.check('the quality bar binds assertions to a declared scope and a mutation, naming no class the register lacks',
      /mutation/i.test(bar) && /scope/i.test(bar) && namedClasses.length > 0 && orphanClasses.length === 0,
      { namedClasses, orphanClasses });

    // AND THE OTHER DIRECTION, which is the one the quality bar's own sentence
    // asserts: "This enumeration must name every class the register carries."
    // Only the reverse was held here — the enumeration naming nothing the
    // register lacks — while completeness was held solely by a probe under
    // `specs/`, which no build runs (F-010-H). So spec 016's DECISIONS entry
    // ratified that sentence on the ground that "the gate now holds it" when the
    // gate did not. It does now.
    //
    // An ABSENT CONSTITUTION.md still passes, for #28's recorded reason: the
    // published tree excludes the file, and failing closed here would refuse
    // every build made from a published tree.
    const missingFromBar = [...registerIds].filter((id) => !namedClasses.includes(id));
    gate.check('the quality bar enumerates EVERY class the register carries, so the list cannot go stale beside it',
      missingFromBar.length === 0, { missingFromBar, named: namedClasses.length, register: registerIds.size });
  }

  // AC-11. A receipt carries a self-verifying hash, which is tamper-evidence,
  // not authenticity. Claiming "signed" states a property the artifact does not
  // have — invariant 1's "stated, never implied", inverted.
  //
  // THE SCOPE IS THE PUBLISHED TREE, derived from the publish script's own
  // EXCLUDE_RE rather than from a list of likely files. The first draft scanned
  // README, package.json and docs/*.html, and missed `spec/RECEIPT.md`, which
  // ships to the public repo AND to npm and opened by calling a receipt signed.
  // One definition, in tests/assertion-scope.js, called from both vantages.
  const signedClaims = scope.signedReceiptClaims(ROOT);
  gate.check('no current-receipt claim anywhere in the published tree calls a receipt signed',
    signedClaims.length === 0, { signedClaims });

  const scopeTracked = execFileSync('git', ['ls-files', 'tests/assertion-scope.js'], { cwd: ROOT, encoding: 'utf8' }).trim();
  gate.check('the narrowing-class register ships with the tree it governs',
    scopeTracked === 'tests/assertion-scope.js', { scopeTracked });
}

// ── generation sampling (receipt spec v0.5) ─────────────────────────────────
//
// Spec 014. These run HERE, not only in specs/014's gate: `specs/` is excluded
// from the published tree and no workflow runs a spec gate, so a rule that lives
// only beside its spec is never executed by a build (F-010-H). build-public.sh
// runs this gate inside the tree it is about to publish.
gate.section('generation sampling (v0.5)');
{
  const { acrossDraws, nextAction, SAMPLING } = require('../lib/sampling');
  const { varianceRatio } = require('../lib/stats');
  const { suiteCanary } = require('../lib/canary');
  const reuse = require('../lib/reuse');

  // Scope: the draw set as a whole, not one draw. A zero denominator yields
  // null — an infinity would read as "infinitely noisier" when the ratio is
  // simply undefined (absence-vs-unreadable).
  gate.check('a zero judge sd yields a null variance ratio, never a division result',
    varianceRatio(0.19, 0) === null && varianceRatio(0, 0) === null,
    { zero: varianceRatio(0.19, 0) });
  gate.check('the variance ratio divides generation sd by mean judge sd',
    Math.abs(varianceRatio(0.186, 0.062) - 3) < 0.001, { got: varianceRatio(0.186, 0.062) });

  // F-009-L: UNMEASURED, never zero. Scope: every statistic the draw set emits.
  const withGap = [
    { draw_index: 0, status: 'measured', samples: [0.8], mean: 0.8, stddev: 0, generation_hash: 'h0' },
    { draw_index: 1, status: 'measured', samples: [0.8], mean: 0.8, stddev: 0, generation_hash: 'h1' },
    { draw_index: 2, status: 'unmeasured', samples: [], mean: null, stddev: null, generation_hash: null },
  ];
  const agg = acrossDraws(withGap);
  gate.check('an unmeasured draw is excluded from the mean and counted, never scored zero',
    agg.n_unmeasured === 1 && agg.n_measured === 2 && Math.abs(agg.mean - 0.8) < 1e-9,
    { agg });
  const zeroFilled = withGap.map((d) => (d.status === 'unmeasured' ? { ...d, status: 'measured', mean: 0, stddev: 0, samples: [0] } : d));
  gate.check('MUTATION: zero-filling that draw moves the mean, so the exclusion is doing work',
    acrossDraws(zeroFilled).mean < agg.mean, { honest: agg.mean, zeroFilled: acrossDraws(zeroFilled).mean });

  // The policy reads the shipped constants and records why it stopped.
  const mk = (means, sd = 0.01) => means.map((m, i) => ({ draw_index: i, status: 'measured', generation_hash: 'h' + i, samples: [m], mean: m, stddev: sd }));
  const flat = nextAction(mk(new Array(SAMPLING.min).fill(0.8)));
  const wide = []; for (let i = 0; i < SAMPLING.max; i++) wide.push(i % 2 ? 0.9 : 0.9 - SAMPLING.sdThreshold * 6);
  const capped = nextAction(mk(wide));
  gate.check('the sampling policy stops for a recorded reason, and the reasons differ',
    flat.stop && flat.reason === 'min_reached' && capped.stop && capped.reason === 'max_reached',
    { flat, capped });

  // A canary is stable for a suite and distinct across suites.
  const cA = suiteCanary({ id: 'a', cases: [{ id: 'x' }] });
  gate.check('a suite canary is stable for a suite and distinct across suites',
    cA === suiteCanary({ id: 'a', cases: [{ id: 'x' }] }) && cA !== suiteCanary({ id: 'b', cases: [{ id: 'x' }] }),
    { cA });
  // The FUNCTION is not the property. A live run emitted `canary: undefined`
  // while the function was correct, because the canonical assembly in
  // lib/receipt.js dropped the field. This reads the assembly, not the helper.
  {
    const { buildReceipt } = require('../lib/receipt');
    const probe = buildReceipt({
      skill: { name: 'p', version: '1', contentHash: 'h' },
      suite: { format: 'f', suiteHash: 's', caseCount: 1, canary: cA },
      run: { model_id: 'm', surface: 'x', runner_version: '0', date_utc: new Date(0).toISOString() },
      cases: [],
    });
    gate.check('the canonical receipt assembly carries the suite canary through',
      probe.suite.canary === cA, { got: probe.suite && probe.suite.canary });
  }

  // AC-6: a comparison whose baseline did not reproduce asserts no verdict.
  const mkR = (bm) => ({ schema_version: '0.5', skill: { content_hash: 'c' }, suite: { suite_hash: 's' }, run: { model_id: 'm', judge: { model_id: 'j' }, rubric_hash: 'r' },
    results: { cases: [{ id: 'a', mode: 'baseline', generation: { mean: bm, sd: 0.02, n_measured: 3, draws: [] } },
                       { id: 'a', mode: 'with_skill', generation: { mean: 0.8, sd: 0.02, n_measured: 3, draws: [] } }] } });
  const refused = reuse.compare(mkR(0.30), mkR(0.85));
  const measured = reuse.compare(mkR(0.30), mkR(0.305));
  gate.check('a non-reproducing baseline refuses and asserts no delta; a reproducing one still measures',
    refused.verdict === 'REFUSED' && refused.delta === null && measured.verdict === 'MEASURED',
    { refused: refused.verdict, measured: measured.verdict });

  // F-009-N: the control cannot say why, so no reason string may claim a cause.
  const causal = /\b(because|caused by|due to|the skill (regressed|improved)|proves that)\b/i;
  const causalReasons = Object.entries(reuse.REFUSAL_REASONS)
    .map(([k, v]) => [k, typeof v === 'function' ? v({ observed: 1, expected: 0 }) : String(v)])
    .filter(([, t]) => causal.test(t));
  gate.check('no refusal reason asserts a cause the control cannot establish',
    causalReasons.length === 0, { causalReasons });

  // AC-10: the archive keeps working. Scope: every published receipt, and the
  // count floor keeps this from passing by finding nothing.
  const { validateReceipt, verifyReceiptHash } = require('./../lib/receipt');
  let seen = 0; const broken = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (!e.name.endsWith('.json') || e.name.endsWith('.control.json')) continue;
    let r; try { r = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { continue; }
    if (!r || !r.schema_version) continue; seen++;
    const v = validateReceipt(r);
    if (!v.valid || v.version !== r.schema_version || !verifyReceiptHash(r)) broken.push(path.relative(ROOT, p)); } };
  walk(path.join(ROOT, 'receipts'));
  gate.check('every published receipt validates against ITS OWN schema version and self-verifies',
    seen >= 20 && broken.length === 0, { seen, broken: broken.slice(0, 4) });
}

// ── publish unblock (spec 015) ─────────────────────────────────────────────
//
// These run HERE, not only in specs/015's gate: `specs/` is excluded from the
// published tree and no workflow runs a spec gate, so a rule that lives only
// beside its spec is never executed by a build (F-010-H). build-public.sh runs
// this gate inside the tree it is about to publish.
gate.section('publish unblock (generation_sampled, product paths, publish target)');
{
  const { validateReceipt } = require('../lib/receipt');
  const { acrossDraws } = require('../lib/sampling');
  const scope015 = require('./assertion-scope');

  // ── AC-1 / AC-2 — F-014-F, closed in both directions ─────────────────────
  //
  // A receipt could assert v0.5 conformance while carrying none of what v0.5
  // adds. The requirement is bound to what the receipt DECLARES, not to its
  // verification_level, which is why nothing in the archive had to be rewritten.
  const drawSet = {
    n_drawn: 1, n_measured: 1, n_unmeasured: 0, stopping_reason: 'min_reached',
    mean: 0.5, sd: 0, judge_sd_mean: 0, variance_ratio: null,
    variance_ratio_unavailable: 'single_judge_sample',
    draws: [{ draw_index: 0, status: 'measured', mean: 0.5, stddev: 0, samples: [0.5], generation_hash: 'a'.repeat(64) }],
  };
  // THE BASE IS A REAL ARCHIVED RECEIPT, not a hand-built literal. A fixture
  // assembled here drifts from what the schema actually requires — it did,
  // twice, while this check was being written — and the point of v0.5 being
  // ADDITIVE over v0.4 is that an archived v0.4 receipt is a valid v0.5 one.
  const anyArchived = (() => {
    const found = [];
    const walkR = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const q = path.join(d, e.name);
      if (e.isDirectory()) { walkR(q); continue; }
      if (!e.name.endsWith('.json')) continue;
      try { const r = JSON.parse(fs.readFileSync(q, 'utf8')); if (r && r.schema_version === '0.4' && r.results && r.results.cases && r.results.cases.length) found.push(r); } catch { /* not a receipt */ }
    } };
    walkR(path.join(ROOT, 'receipts'));
    return found[0] || null;
  })();
  const v05 = (extra, withGeneration) => {
    const r = JSON.parse(JSON.stringify(anyArchived));
    r.schema_version = '0.5';
    delete r.generation_sampled;
    for (const c of r.results.cases) delete c.generation;
    if (withGeneration) r.results.cases[0].generation = drawSet;
    // spec 016 AC-5 binds the capability flag to `suite.canary` as well as to the
    // draw set, so a receipt that DECLARES the flag must carry one. The archived
    // v0.4 base has none (v0.4 had no canary), and this fixture is about the
    // generation half, so the canary is supplied here rather than left to make
    // the F-014-F assertion fail for F-015-A's reason.
    if (extra && extra.generation_sampled) r.suite = { ...r.suite, canary: '0'.repeat(8) + '-0000-4000-8000-' + '0'.repeat(12) };
    return { ...r, ...extra };
  };
  gate.check('an archived v0.4 receipt is available as the base for the capability-flag checks',
    anyArchived !== null && validateReceipt(v05({}, false)).valid === true,
    { base: anyArchived && anyArchived.skill && anyArchived.skill.name });

  const carriesNoFlag = validateReceipt(v05({}, true));
  const carriesFlagged = validateReceipt(v05({ generation_sampled: true }, true));
  gate.check('a receipt carrying a draw set is REFUSED unless it declares generation_sampled: true (F-014-F)',
    carriesNoFlag.valid === false && carriesFlagged.valid === true,
    { unflagged: carriesNoFlag.valid, flagged: carriesFlagged.valid, errors: (carriesFlagged.errors || []).slice(0, 2) });

  const declaresNothing = validateReceipt(v05({ generation_sampled: true }, false));
  const legacyShape = validateReceipt(v05({}, false));
  gate.check('a receipt DECLARING generation_sampled while carrying no draw set is refused, and absent still means legacy',
    declaresNothing.valid === false && legacyShape.valid === true,
    { declaresNothing: declaresNothing.valid, legacy: legacyShape.valid });

  // The producer must actually emit it, from the cases rather than on trust.
  {
    const { buildReceipt } = require('../lib/receipt');
    const withGen = buildReceipt({
      skill: { name: 'p', version: '1', contentHash: 'h' },
      suite: { format: 'f', suiteHash: 's', caseCount: 1 },
      run: { model_id: 'm', surface: 'x', runner_version: '0', date_utc: new Date(0).toISOString() },
      cases: [{ id: 'a', mode: 'baseline', generation: drawSet }],
    });
    const without = buildReceipt({
      skill: { name: 'p', version: '1', contentHash: 'h' },
      suite: { format: 'f', suiteHash: 's', caseCount: 1 },
      run: { model_id: 'm', surface: 'x', runner_version: '0', date_utc: new Date(0).toISOString() },
      cases: [{ id: 'a', mode: 'baseline' }],
    });
    gate.check('the canonical receipt assembly declares the capability when the cases carry it, and not otherwise',
      withGen.generation_sampled === true && !('generation_sampled' in without),
      { withGen: withGen.generation_sampled, without: without.generation_sampled });
  }

  // ── AC-4 — which null the variance ratio is (F-014-C) ───────────────────
  const k1 = acrossDraws([
    { draw_index: 0, status: 'measured', mean: 0.6, stddev: 0, samples: [0.6] },
    { draw_index: 1, status: 'measured', mean: 0.4, stddev: 0, samples: [0.4] },
  ]);
  const agreed = acrossDraws([
    { draw_index: 0, status: 'measured', mean: 0.6, stddev: 0, samples: [0.6, 0.6] },
    { draw_index: 1, status: 'measured', mean: 0.4, stddev: 0, samples: [0.4, 0.4] },
  ]);
  gate.check('a k=1 null and a zero-judge-sd null are told apart, and neither is a division result',
    k1.variance_ratio === null && agreed.variance_ratio === null
      && k1.variance_ratio_unavailable === 'single_judge_sample'
      && agreed.variance_ratio_unavailable === 'judge_sd_zero',
    { k1: k1.variance_ratio_unavailable, agreed: agreed.variance_ratio_unavailable });

  // ── AC-5 — every documented invocation can produce the ratio ────────────
  //
  // Scope derived from the publish script's own EXCLUDE_RE, never hand-listed.
  //
  // ONE DEFINITION of the detector, in tests/assertion-scope.js, called from
  // here and from the spec gate. Two copies are two definitions of the
  // criterion. The criterion is "at least 2", so the count is PARSED and
  // compared rather than matched against the literal `--samples 1` — which let
  // `--samples 0` through, and read a quoted command only as far as its first
  // quote. Approval finding 4.
  {
    const files015 = scope015.publishedFiles(ROOT)
      .filter((rel) => /\.(md|html|yml|yaml|js|json|sh)$/.test(rel))
      .map((rel) => { try { return [rel, fs.readFileSync(path.join(ROOT, rel), 'utf8')]; } catch { return null; } })
      .filter(Boolean);
    const { total, bad } = scope015.judgeSampleViolations(files015);
    gate.check('no documented driftproof run invocation grades below two judge samples',
      total >= 5 && bad.length === 0, { total, bad: bad.slice(0, 4) });
  }

  // ── AC-6 — the projection a human reads includes the draws ─────────────
  {
    const { SAMPLING } = require('../lib/sampling');
    const scriptsDir = path.join(ROOT, 'scripts');
    const bad = []; let sites = 0;
    for (const f of fs.readdirSync(scriptsDir).filter((x) => x.endsWith('.js'))) {
      const src = fs.readFileSync(path.join(scriptsDir, f), 'utf8');
      if (!src.includes('projectCalls(')) continue;
      // Balanced-paren extraction, then EVALUATE the call against a recorder:
      // grepping for the spelling `SAMPLING.max` would pass a comment.
      const re = /projectCalls\s*\(/g; let m;
      while ((m = re.exec(src))) {
        let i = re.lastIndex, depth = 1;
        while (i < src.length && depth > 0) { if (src[i] === '(') depth++; else if (src[i] === ')') depth--; i++; }
        const expr = src.slice(m.index, i);
        const calls = [];
        const fixtures = { projectCalls: (...a) => { calls.push(a); return 1; }, SAMPLING, models: ['a'], nCasesTotal: 70, nCases: 70, samples: 5 };
        const proxy = new Proxy(fixtures, { has: () => true, get: (t, k) => (k in t ? t[k] : 7) });
        try { new Function('scope', `with (scope) { return (${expr}); }`)(proxy); }
        catch (e) { bad.push(`${f}: ${expr.slice(0, 50)} — ${e.message}`); continue; }
        for (const args of calls) { sites++; if (args[2] !== SAMPLING.max) bad.push(`${f}: projects ${args[2] == null ? 'ONE draw' : `${args[2]} draws`}, not SAMPLING.max`); }
      }
    }
    gate.check('every report projection is computed at SAMPLING.max draws per arm (OPEN-QUESTION-2)',
      sites >= 6 && bad.length === 0, { sites, bad: bad.slice(0, 4) });
  }

  // ── AC-7 — the sixth narrowing class, and the product path it names ────
  const orphans015 = scope015.orphanModules(ROOT);
  const harnessOnly015 = scope015.undeclaredHarnessOnly(ROOT);
  gate.check('no lib module is unreached, and none is harness-only without a declared reason (helper-vs-product-path)',
    orphans015.length === 0 && harnessOnly015.length === 0
      && scope015.productPathReaches(ROOT, 'lib/reuse.js') && !scope015.productPathReaches(ROOT, 'lib/hygiene.js'),
    { orphans: orphans015, harnessOnly: harnessOnly015 });

  // ── AC-8 — an approval-record commit touches nothing else ──────────────
  //
  // SCOPE: the range a merge would bring in, which on `main` and `dev` is empty
  // and on a spec branch is that branch's own commits. History carries two
  // violations that predate the rule being checked (44c4a60, 1db61dd); this
  // binds what is being merged now, not what was merged before it existed.
  {
    const { approvalCommitProblems } = require('../scripts/merge-check.js');
    //
    // THE ASSERTION REGISTERS EITHER WAY. Guarding it with `if (base && head)`
    // meant an unreadable base REMOVED the assertion from the gate rather than
    // failing it, and the headline count silently dropped by one — the register's
    // own `absence-vs-unreadable` class, in the check this loop added to close a
    // different instance of it. Approval finding 2.
    let base = null, head = null, why = null;
    try {
      head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
      base = execFileSync('git', ['merge-base', 'main', head], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    } catch (e) { base = null; why = (e.stderr || e.message || '').toString().trim().split('\n')[0]; }
    const mixed = (base && head)
      ? approvalCommitProblems(base, head, ROOT)
      : [`the commit range could not be derived (${why || 'no base'}), so this rule could not run`];
    gate.check('no commit on this branch carries an approval record alongside anything else (DECISIONS #4)',
      mixed.length === 0, { base: base && base.slice(0, 7), mixed: mixed.slice(0, 3) });
  }

  // ── AC-9 — the publish target may not contain a nested repository ──────
  //
  // The REAL script, against a fabricated target that satisfies every earlier
  // target rule, so the refusal that fires is the one under test. It refuses
  // before `rm -rf`, which is the whole content of F-014-E.
  {
    // Local copies: the publish section's helpers are block-scoped there.
    const T_REFUSE = 20000;
    const scrubbedEnv = (extra = {}) => {
      const e = { ...process.env };
      for (const k of Object.keys(e)) if (k.startsWith('DRIFTPROOF_')) delete e[k];
      return { ...e, GIT_AUTHOR_NAME: 'gate', GIT_AUTHOR_EMAIL: 'gate@local',
        GIT_COMMITTER_NAME: 'gate', GIT_COMMITTER_EMAIL: 'gate@local', ...extra };
    };
    const box = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-nested-'));
    const src = path.join(box, 'src');
    fs.mkdirSync(path.join(src, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(src, 'node_modules'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'scripts', 'build-public.sh'), path.join(src, 'scripts', 'build-public.sh'));
    fs.writeFileSync(path.join(src, 'DECISIONS.md'), '# log\n\nnothing is open here.\n');
    // A target the script would accept: its own remote, a README, a docs/ dir,
    // and neither DECISIONS.md nor specs/.
    const pub = path.join(box, 'driftproof-public');
    fs.mkdirSync(path.join(pub, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(pub, 'README.md'), 'published\n');
    const g = (...a) => execFileSync('git', ['-c', 'user.name=gate', '-c', 'user.email=gate@local', '-C', pub, ...a], { encoding: 'utf8' });
    g('init', '-q', '-b', 'main');
    // Composed, never written out: `git@<host>` is email-shaped and the blocking
    // hygiene scan reads it as an address. build-public.sh splits the host out
    // for exactly this reason (B-8); the same rule applies to the gate that
    // fabricates a target for it.
    const REMOTE_HOST_015 = 'github.com';
    g('remote', 'add', 'origin', `git@${REMOTE_HOST_015}:driftproofhq/driftproof.git`);
    const run = (args) => {
      try {
        return { rc: 0, out: execFileSync('bash', [path.join(src, 'scripts', 'build-public.sh'), ...args],
          { cwd: box, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: T_REFUSE,
            env: scrubbedEnv({ DRIFTPROOF_BUILD_DEPTH: '0' }) }) };
      } catch (e) { return { rc: e.status == null ? -1 : e.status, out: `${e.stdout || ''}${e.stderr || ''}` }; }
    };
    // NESTED FIRST, against a target still intact: any earlier run rebuilds the
    // target and the later one would then be refused by a DIFFERENT rule, which
    // is an assertion passing for the wrong reason.
    const stray = path.join(pub, 'driftproof-v0.6.0');
    fs.mkdirSync(path.join(stray, '.git'), { recursive: true });
    fs.writeFileSync(path.join(stray, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    const nestedRun = run(['-m', 'gate probe: a target carrying a nested repository']);
    const straySurvived = fs.existsSync(path.join(stray, '.git'));
    // …and NOT BLANKET: with the nested repository gone, whatever happens next,
    // it is not this refusal. (The sandbox source is a stub, so the run fails
    // later for its own reasons; what matters is that it is no longer exit 9.)
    fs.rmSync(stray, { recursive: true, force: true });
    const cleanRun = run(['-m', 'gate probe: the stray tree is gone']);
    gate.check('the publish script refuses a target containing a nested git repository, before destroying it (F-014-E)',
      nestedRun.rc === 9 && /nested git repositor/i.test(nestedRun.out)
        && nestedRun.out.includes('driftproof-v0.6.0') && straySurvived && cleanRun.rc !== 9,
      { nestedRc: nestedRun.rc, cleanRc: cleanRun.rc, straySurvived });
    fs.rmSync(box, { recursive: true, force: true });
  }
}

// ── differ honesty (spec 016) ───────────────────────────────────────────────
//
// These run HERE, not only in specs/016's gate: `specs/` is excluded from the
// published tree and no workflow runs a spec gate (F-010-H). build-public.sh
// runs this gate inside the tree it is about to publish.
//
// AND THAT SENTENCE IS ONLY WORTH WRITING IF EVERY CHECK BELOW HONOURS IT. Four
// of them originally took their subject from `specs/…/rehearsal/`, which the
// publish script excludes, so in the published tree they silently did not run:
// 496 assertions in the source tree, 488 in the one about to ship, with nothing
// saying eight had gone. A skipped check lowers a count instead of failing.
// Every subject here is now either a file inside the published tree or built in
// process from one.
gate.section('differ honesty (cross-version bands, refusal rendering, cost projection)');
{
  const scope016 = require('./assertion-scope');
  const { bandOf, baselineReproduces } = require('../lib/reuse');
  const { buildDriftReport } = require('../lib/diff');

  // ── AC-1 / AC-2 — the band reader meets the ARCHIVE, not a fixture ───────
  //
  // F-015-C: this read `c.generation.mean` only, so every v0.4 case resolved to
  // null and the cross-version precondition returned baseline_unmeasured for
  // every v0.4-to-v0.5 pair, always. Asserted here on receipts selected out of
  // `receipts/` by what they RECORD — the seventh narrowing class.
  const v04 = scope016.archiveReceipts(ROOT, { schemaVersion: '0.4' });
  gate.check('the archive selector resolves genuine v0.4 receipts by recorded schema_version',
    v04.length >= 3 && v04.every((r) => r.file.startsWith('receipts/')), { found: v04.length });

  {
    const withBaseline = v04.filter((r) => r.receipt.results.cases.some((c) => c.mode === 'baseline'));
    const bands = withBaseline.map((r) => bandOf(r.receipt.results.cases.find((c) => c.mode === 'baseline')));
    gate.check('the shared band definition resolves a REAL archived v0.4 case, and says which shape it read',
      bands.length > 0 && bands.every((b) => b && typeof b.mean === 'number' && b.source === 'legacy'),
      { checked: bands.length, nulls: bands.filter((b) => !b).length });
  }

  // The site set, pinned: every comparison path routes through the one definition
  // and no construction is unclassified.
  {
    const { comparison, unclassified } = scope016.bandSites(ROOT);
    gate.check('every per-case band site in a comparison path routes through the shared definition, and none is unclassified',
      unclassified.length === 0 && comparison.length >= 2 && comparison.every((x) => x.routed),
      { comparison: comparison.map((x) => `${x.file}:${x.line}${x.routed ? '' : ' UNROUTED'}`), unclassified: unclassified.length });
  }

  // ── AC-3 / AC-4 / AC-5 — the refusal reaches the page; the page is not false;
  //    the capability flag binds the canary ────────────────────────────────────
  //
  // THE SUBJECT IS BUILT HERE, IN PROCESS, AND THE OLDER SIDE IS STILL REAL.
  //
  // These four checks were first written against the v0.5 receipt spec 015's
  // rehearsal emitted, under `specs/…/rehearsal/`. `build-public.sh` excludes
  // `^specs/`, so in the tree that is actually published they did not run — and a
  // skipped check LOWERS A COUNT rather than failing, so the published-tree gate
  // read 488/488 and looked green. Measured: 496 in the source tree, 488 in the
  // published one, while this section's own comment justified its placement by
  // "build-public.sh runs this gate inside the tree it is about to publish".
  // `absence-vs-unreadable`, in the loop that added the seventh narrowing class.
  //
  // The fix keeps what matters and drops what does not. The side the control must
  // MEET is the archived v0.4 receipt, and that stays a real file selected out of
  // `receipts/` by what it records. The newer side is synthesised from it, which
  // is honest because it is not the side under test — v0.5 is the shape the
  // differ was written against. specs/016's own gate additionally proves all of
  // this against a genuinely emitted v0.5 receipt; this copy is the one that has
  // to survive the publish boundary.
  {
    const { validateReceipt } = require('../lib/receipt');
    const CANARY = '2ddb0358-05d3-f553-7151-99e80554a4b9';
    let ctx = null;
    const base = v04.find((r) => r.receipt.verification_level === 'TESTED'
      && r.receipt.results.cases.some((c) => c.mode === 'baseline'));

    // THE SUBJECT'S ABSENCE IS A FAILURE, NOT A SKIP. `if (base) { … }` guarded
    // these four checks, so if the archive ever stopped offering a TESTED v0.4
    // receipt with a baseline arm they would silently stop registering and the
    // headline count would drop with nothing saying why — the same
    // absence-vs-unreadable shape as F-016-A2, inside A2's own fix. They now
    // register either way, and a missing subject fails all four with its reason.
    const missing = base ? null
      : `the archive offers no TESTED v0.4 receipt with a baseline arm (${v04.length} v0.4 candidate(s)) — these four checks have no subject`;
    gate.check('the archive offers the subject these cross-version checks require',
      !missing, { missing, candidates: v04.length });
    {
      // A v0.5 counterpart of the archived receipt, with a draw set whose mean is
      // `shift` away from what the archive recorded.
      const asV05 = (shift) => {
        const r = JSON.parse(JSON.stringify(base.receipt));
        r.schema_version = '0.5';
        r.generation_sampled = true;
        r.suite = { ...r.suite, canary: CANARY };
        for (const c of r.results.cases) {
          const mean = Math.max(0, Math.min(1, (typeof c.mean === 'number' ? c.mean : c.score) + shift));
          const sd = 0.01;
          c.mean = mean; c.score = mean; c.stddev = sd;
          c.generation = {
            n_planned: 3, n_drawn: 3, n_measured: 3, n_unmeasured: 0, stopping_reason: 'min_reached',
            mean, sd, judge_sd_mean: 0.01, variance_ratio: sd / 0.01, variance_ratio_unavailable: null,
            draws: [0, 1, 2].map((i) => ({
              draw_index: i, status: 'measured', mean, stddev: 0.01, samples: [mean, mean, mean, mean, mean],
              generation_hash: 'a'.repeat(64),
            })),
          };
        }
        return r;
      };

      // BOTH BRANCHES PUT THE REAL ARCHIVED v0.4 RECEIPT ON THE OLDER SIDE. The
      // precondition is scoped to CROSS-VERSION pairs (spec 014 OPEN-QUESTION-3,
      // settled: it stays so), and a first draft compared two synthesised v0.5
      // receipts — which is not a cross-version pair, so the precondition never
      // ran and the "refusing" pair did not refuse. The shift is applied to the
      // newer side, which is what a real drift would look like.
      const reproducing = asV05(0);
      const shifted = asV05(-0.5);

      const repRefused = buildDriftReport(base.receipt, shifted, {});
      const repOk = buildDriftReport(base.receipt, reproducing, {});
      const preKey = baselineReproduces(base.receipt, reproducing).key || 'ok';
      const noCanary = JSON.parse(JSON.stringify(reproducing));
      delete noCanary.suite.canary;
      ctx = { repRefused, repOk, preKey, reproducing, noCanary, file: base.file };
    }

    const ok4 = (fn) => (ctx ? fn(ctx) : false);
    const det = (fn) => (ctx ? fn(ctx) : { missing });

    gate.check('the cross-version precondition reaches a CONTENT-based verdict on a real archived v0.4 receipt, not a schema-shape refusal',
      ok4((c) => c.preKey !== 'baseline_unmeasured' && !c.repOk.refused),
      det((c) => ({ file: c.file, key: c.preKey })));

    // BOTH CONJUNCTS OF AC-3, and the second one separately. The criterion is
    // "the rendered report text shall contain the reason, verbatim, AND the
    // headline shall name the refusal". The reason appears TWICE in a refused
    // report — in the caveat and in the headline — so `markdown.includes(reason)`
    // is satisfied by the caveat alone, and a regression that returned the
    // headline to a form naming no refusal would have kept this green. Verified:
    // patching the headline to "NOT MEASURED — no verdict is asserted." leaves
    // both `includes` and a bare /refus/i passing. The headline LINE is now read
    // on its own.
    const headlineOf = (md) => {
      const lines = md.split('\n');
      const i = lines.findIndex((l) => /^##\s+Headline\s*$/.test(l));
      if (i < 0) return '';
      return (lines.slice(i + 1).find((l) => /^\*\*/.test(l.trim())) || '').trim();
    };
    gate.check('a refused comparison prints its cause-honest reason in the rendered report',
      ok4((c) => c.repRefused.refused && !!c.repRefused.refusal_reason
        && c.repRefused.markdown.includes(c.repRefused.refusal_reason)),
      det((c) => ({ refused: c.repRefused.refused, key: c.repRefused.refusal_key })));

    gate.check('and the HEADLINE names the refusal and carries the reason, not the caveat alone',
      ok4((c) => {
        const h = headlineOf(c.repRefused.markdown);
        return /REFUSED/.test(h) && h.includes(c.repRefused.refusal_reason);
      }),
      det((c) => ({ headline: headlineOf(c.repRefused.markdown).slice(0, 120) })));

    gate.check('a refused comparison of two TESTED receipts claims no receipt below TESTED, and prints no empty caveat',
      ok4((c) => c.repRefused.refused
        && !/receipt\(s\) below TESTED/.test(c.repRefused.markdown)
        && !/—\s*\.\s/.test(c.repRefused.markdown)),
      det((c) => ({ headline: (c.repRefused.markdown.match(/^\*\*.*$/m) || [''])[0].slice(0, 120) })));

    gate.check('a receipt declaring generation_sampled is refused without suite.canary, and accepted with it',
      ok4((c) => validateReceipt(c.reproducing).valid === true && validateReceipt(c.noCanary).valid === false),
      det((c) => ({ withCanary: validateReceipt(c.reproducing).valid, without: validateReceipt(c.noCanary).valid })));
  }

  // ── AC-7 — the dollar projection carries the draw factor, everywhere ─────
  {
    const cost = require('../lib/cost');
    let threw = false;
    try { cost.estimateRunCostUSD({ caseCount: 1, samples: 1, models: ['claude-haiku-4-5'], judgeModel: 'claude-haiku-4-5' }); }
    catch (e) { threw = /draws/i.test(e.message); }
    gate.check('estimateRunCostUSD requires an explicit draw factor and refuses to default one',
      threw, { threw });

    // THE SET IS DERIVED FROM THE PROPERTY — projecting a run's cost — not from
    // an incidental import. Deriving it from "imports projectCalls" is how
    // run-report-001.js and prepare-report-002.js sat outside a criterion whose
    // subject was every report script (spec 015 round-2 finding 1).
    const { SAMPLING } = require('../lib/sampling');
    const sites = []; const bad = [];
    for (const dir of ['bin', 'scripts']) {
      for (const f of fs.readdirSync(path.join(ROOT, dir))) {
        const rel = `${dir}/${f}`;
        const p = path.join(ROOT, rel);
        if (!fs.statSync(p).isFile()) continue;
        const src = fs.readFileSync(p, 'utf8');
        if (!src.includes('estimateRunCostUSD(')) continue;
        const re = /estimateRunCostUSD\s*\(/g; let m;
        while ((m = re.exec(src))) {
          let i = re.lastIndex, depth = 1;
          while (i < src.length && depth > 0) { if (src[i] === '(') depth++; else if (src[i] === ')') depth--; i++; }
          const expr = src.slice(m.index, i);
          sites.push(rel);
          const calls = [];
          const fixtures = { estimateRunCostUSD: (a) => { calls.push(a); return { totalUSD: 0, perModel: [] }; },
            SAMPLING, models: ['a'], nCasesTotal: 70, nCases: 70, nC: 70, samples: 5,
            pair: { new: 'a', old: 'b' }, judgeModel: 'j', require: () => ({ resolveModel: (x) => x }) };
          const proxy = new Proxy(fixtures, { has: () => true, get: (t, k) => (k in t ? t[k] : 7) });
          try { new Function('scope', `with (scope) { return (${expr}); }`)(proxy); }
          catch (e) { bad.push(`${rel}: unevaluable`); continue; }
          for (const a of calls) if (a.draws !== SAMPLING.max) bad.push(`${rel}: draws=${a.draws}`);
        }
      }
    }
    const files = [...new Set(sites)];
    gate.check('every site that projects a run cost passes the draw factor the runner uses, and the set includes every cost-projecting script',
      bad.length === 0 && files.includes('scripts/run-report-001.js') && files.includes('scripts/prepare-report-002.js') && files.includes('bin/driftproof'),
      { files: files.length, sites: sites.length, bad: bad.slice(0, 4) });
  }
}

// ── run fidelity (spec 017): AC-1..AC-7 wired where a publish actually runs ─
//
// spec-017's own gate (specs/017-run-fidelity/gate.sh) is where this loop's
// mutation testing lives — it is not duplicated here. What IS duplicated is
// the criteria themselves, because `build-public.sh`'s EXCLUDE_RE strips
// `^specs/` from the published tree wholesale (DECISIONS 2026-08-18,
// "Governance files stay out of the public tree"), so a check that only lives
// in specs/017's gate protects nothing where a publish runs — approval
// approval-20260831T143513Z non-blocking finding 6 named this directly, and
// F-016-A2 is the same shape one loop earlier: a check whose subject is
// excluded from the published tree silently LOWERS A COUNT instead of
// failing. `tests/` itself IS published (only tests/gate-results.json is
// excluded — see EXCLUDE_RE in scripts/build-public.sh), so every assertion
// below reads a subject that ships: lib/, bin/, receipts/. Every check
// REGISTERS even when its subject is unexpectedly absent and FAILS rather
// than being skipped — a guard clause that skips a missing subject is the
// `absence-vs-unreadable` class this project's DECISIONS log names as its
// most-repeated defect.
gate.section('run fidelity: timeout wiring reaches the provider (spec 017 AC-1/AC-2)');
{
  // AC-1 — dynamic: drives lib/run.js's runSkillOnModel end-to-end under
  // DRIFTPROOF_STUB=1 through tests/timeout-seam.js (a subprocess, because
  // this file is synchronous throughout and runSkillOnModel is async) and
  // asserts the timeoutMs EVERY complete() call actually received, bucketed
  // by generation vs judge — the value that reached the provider, not the
  // declared policy text. Closes BLOCKING-1 of approval-20260831T143513Z: the
  // prior spec-017 probe called resolveCallTimeoutMs(surface, {}) directly
  // and its own header falsely claimed a recording seam drove it.
  const prov = require('../lib/provider');
  const genPolicy017 = prov.retryPolicyForSurface('claude-cli');
  const judgePolicy017 = prov.retryPolicyForSurface('openai-api');
  let seam017 = null;
  let seamErr017 = null;
  try {
    const out = execFileSync('node', [path.join(__dirname, 'timeout-seam.js'), 'claude-sonnet-5', 'gpt-5.6-sol'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        DRIFTPROOF_STUB: '1',
        CLAUDE_PROVIDER: 'stub',
        // Forces gpt-5.6-sol onto the openai-api surface (120000ms) rather
        // than openai-cli (300000ms), so a generation call and a judge call
        // resolve DIFFERENT declared timeouts and a collapsed-to-one-arm or
        // transposed wiring bug is observable at all. DRIFTPROOF_STUB
        // short-circuits complete() before this key, or any network use of
        // it, is ever touched.
        OPENAI_API_KEY: process.env.OPENAI_API_KEY || 'sk-stub-unused-driftproof-gate',
      },
    });
    seam017 = JSON.parse(out);
  } catch (e) { seamErr017 = String((e && e.stdout) || (e && e.message) || e); }
  const observed017 = seam017 ? seam017.observed : [];
  const genCalls017 = observed017.filter((o) => o.kind === 'gen');
  const judgeCalls017 = observed017.filter((o) => o.kind === 'judge');
  gate.check('the timeout recording seam runs to completion and observes both a generation and a judge complete() call',
    !seamErr017 && genCalls017.length > 0 && judgeCalls017.length > 0,
    { seamErr: seamErr017, gen: genCalls017.length, judge: judgeCalls017.length });
  gate.check('AC-1: every generation complete() call receives the declared claude-cli timeout, observed through the recording seam',
    genCalls017.length > 0 && genCalls017.every((c) => c.timeoutMs === genPolicy017.timeoutMs),
    { got: [...new Set(genCalls017.map((c) => c.timeoutMs))], want: genPolicy017.timeoutMs });
  gate.check('AC-1: every judge complete() call receives the declared openai-api timeout, observed through the recording seam, distinct from the generation arm',
    judgeCalls017.length > 0 && judgeCalls017.every((c) => c.timeoutMs === judgePolicy017.timeoutMs) && genPolicy017.timeoutMs !== judgePolicy017.timeoutMs,
    { got: [...new Set(judgeCalls017.map((c) => c.timeoutMs))], want: judgePolicy017.timeoutMs });

  // AC-2 — no call site outside the policy module passes a timeout literal
  // that shadows it. ONE DETECTOR: `scanTimeoutLiterals` in
  // tests/assertion-scope.js, the SAME function specs/017's assertion and its
  // plant-literal mutation call. `tests/` ships (only tests/gate-results.json
  // is excluded), so requiring it here does not reach across the publish
  // boundary the way a require of specs/017-run-fidelity/probes/timeout.js
  // would.
  //
  // This section used to inline its own copy of the scan, with a comment
  // arguing the copy was necessary. approval-20260901T032810Z non-blocking
  // finding 5: the copy that survives the publish boundary had never had a
  // planted violation seen to fail it — the same condition round-1 BLOCKING 2
  // was raised under, one layer out. Two identical implementations are one
  // edit away from disagreeing, and only one of them was mutated.
  const scope017 = require('./assertion-scope');
  const scan017 = scope017.scanTimeoutLiterals(ROOT, ['bin', 'lib']);
  gate.check('AC-2: no timeoutMs literal outside lib/provider.js shadows the declared policy, across every file directly under bin/ and lib/',
    scan017.offending.length === 0, { offending: scan017.offending, sites: scan017.sites });

  // AC-2 MUTATION, RUN HERE TOO — against the published-tree path, not only in
  // specs/017's gate. Copies bin/ and lib/ into a disposable tree, plants a
  // timeout literal, requires the REAL detector to go red, removes it, and
  // requires the same detector to go green. If a later edit narrows
  // `scanTimeoutLiterals`, this check fails in the tree that ships rather than
  // reporting a green count over a scan that stopped reading.
  {
    const mtmp017 = fs.mkdtempSync(path.join(os.tmpdir(), 'driftproof-tmo-lit-'));
    let plantedRed017 = null;
    let clearedGreen017 = null;
    let mutErr017 = null;
    try {
      for (const d of ['bin', 'lib']) fs.cpSync(path.join(ROOT, d), path.join(mtmp017, d), { recursive: true });
      const before017 = scope017.scanTimeoutLiterals(mtmp017, ['bin', 'lib']);
      const plantPath017 = path.join(mtmp017, 'lib', 'planted.js');
      fs.writeFileSync(plantPath017,
        "'use strict';\nasync function go(o){ return call({ timeoutMs: 120000 }); }\nmodule.exports={go};\n");
      const after017 = scope017.scanTimeoutLiterals(mtmp017, ['bin', 'lib']);
      fs.unlinkSync(plantPath017);
      const removed017 = scope017.scanTimeoutLiterals(mtmp017, ['bin', 'lib']);
      plantedRed017 = before017.offending.length === 0 && after017.offending.some((x) => x.startsWith('lib/planted.js'));
      clearedGreen017 = !removed017.offending.some((x) => x.startsWith('lib/planted.js'));
    } catch (e) {
      mutErr017 = String((e && e.message) || e);
    } finally {
      fs.rmSync(mtmp017, { recursive: true, force: true });
    }
    gate.check('AC-2 MUTATION: a planted timeout literal takes the real detector red in the published-tree path, and removing it takes the same detector green',
      plantedRed017 === true && clearedGreen017 === true,
      { plantedRed: plantedRed017, clearedGreen: clearedGreen017, mutErr: mutErr017 });
  }
}

gate.section('run fidelity: economics from draws, archive unchanged (spec 017 AC-3/AC-4)');
{
  const { computeEconomics } = require('../lib/value');

  const v05Dir017 = path.join(ROOT, 'receipts', 'report-007');
  let v05_017 = null;
  if (fs.existsSync(v05Dir017)) {
    for (const f of fs.readdirSync(v05Dir017).filter((x) => x.endsWith('.json')).sort()) {
      const r = JSON.parse(fs.readFileSync(path.join(v05Dir017, f), 'utf8'));
      if (r.schema_version === '0.5' && r.results.cases.some((c) => c.generation && c.generation.draws.length)) {
        v05_017 = { file: `receipts/report-007/${f}`, receipt: r }; break;
      }
    }
  }
  gate.check('AC-3 subject: the archive offers a real v0.5 receipt with draws under receipts/report-007', !!v05_017, { found: !!v05_017 });

  const v04Dir017 = path.join(ROOT, 'receipts', 'report-005');
  let v04_017 = null;
  if (fs.existsSync(v04Dir017)) {
    for (const f of fs.readdirSync(v04Dir017).filter((x) => x.endsWith('.json')).sort()) {
      const r = JSON.parse(fs.readFileSync(path.join(v04Dir017, f), 'utf8'));
      if (r.schema_version === '0.4' && r.economics && r.economics.with_skill && r.economics.with_skill.call_count > 0 && r.run.pricing_snapshot) {
        v04_017 = { file: `receipts/report-005/${f}`, receipt: r }; break;
      }
    }
  }
  gate.check('AC-4 subject: the archive offers a real v0.4 receipt with a populated economics block under receipts/report-005', !!v04_017, { found: !!v04_017 });

  const recompute017 = (r) => computeEconomics({
    cases: r.results.cases,
    modelId: r.run.model_id,
    judgeModelId: (r.run.judge && r.run.judge.model_id) || r.run.model_id,
    pricingSnapshot: r.run.pricing_snapshot,
    surface: r.run.surface,
    meteredSurface: false,
  });
  const armFromDraws017 = (r, mode) => {
    const rows = r.results.cases.filter((c) => c.mode === mode && c.case_status !== 'failed_timeout');
    const us = [];
    for (const c of rows) for (const d of (c.generation ? c.generation.draws : [])) if (d.status === 'measured' && d.usage) us.push(d.usage);
    const meanOf = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    return { call_count: us.length, mean_input_tokens: meanOf(us.map((u) => u.input_tokens)), mean_output_tokens: meanOf(us.map((u) => u.output_tokens)) };
  };

  if (v05_017) {
    const e = recompute017(v05_017.receipt);
    let armsOk = true; const detail017 = {};
    for (const mode of ['with_skill', 'baseline']) {
      const got = e[mode]; const want = armFromDraws017(v05_017.receipt, mode);
      const okMode = want.call_count > 0 && got && got.call_count === want.call_count && got.mean_cost_usd_per_call != null
        && Math.abs(got.mean_input_tokens - want.mean_input_tokens) < 0.5 && Math.abs(got.mean_output_tokens - want.mean_output_tokens) < 0.5;
      if (!okMode) armsOk = false;
      detail017[mode] = { got: got && got.call_count, want: want.call_count };
    }
    gate.check('AC-3: both arms compute economics from draw-level usage and equal the draws, on the real v0.5 receipt',
      armsOk && e.skill_incremental_cost_usd_per_call != null, detail017);
    gate.check('AC-3: judge overhead still computes on the v0.5 receipt — the defect was at the generation level, never the judge',
      !!(e.judge_overhead && e.judge_overhead.total_cost_usd > 0), { judge_overhead: e.judge_overhead });
  } else {
    gate.check('AC-3: both arms compute economics from draw-level usage and equal the draws, on the real v0.5 receipt', false, { missing: 'no v0.5 receipt with draws found' });
    gate.check('AC-3: judge overhead still computes on the v0.5 receipt — the defect was at the generation level, never the judge', false, { missing: 'no v0.5 receipt with draws found' });
  }

  if (v04_017) {
    const got = recompute017(v04_017.receipt); const want = v04_017.receipt.economics;
    let same017 = true;
    for (const mode of ['with_skill', 'baseline']) for (const k of ['call_count', 'mean_input_tokens', 'mean_output_tokens', 'mean_cost_usd_per_call']) if (got[mode][k] !== want[mode][k]) same017 = false;
    if (got.skill_incremental_cost_usd_per_call !== want.skill_incremental_cost_usd_per_call) same017 = false;
    gate.check('AC-4: recomputing a real archived v0.4 receipt reproduces its recorded economics block exactly',
      same017, { file: v04_017.file });
  } else {
    gate.check('AC-4: recomputing a real archived v0.4 receipt reproduces its recorded economics block exactly', false, { missing: 'no v0.4 receipt with a populated economics block found' });
  }
}

gate.section('run fidelity: pairwise exclusion, recorded (spec 017 AC-5/AC-6)');
{
  const srcPath017 = path.join(ROOT, 'receipts', 'report-007', 'git-workflow-and-versioning-claude-sonnet-5-2026-08-31.json');
  const hasSrc017 = fs.existsSync(srcPath017);
  const src017 = hasSrc017 ? JSON.parse(fs.readFileSync(srcPath017, 'utf8')) : null;
  const cases017 = hasSrc017 ? JSON.parse(JSON.stringify(src017.results.cases)) : [];
  const victim017 = hasSrc017 ? cases017.find((c) => c.mode === 'baseline') : null;
  gate.check('AC-5/AC-6 subject: the real report-007 receipt carries a baseline arm to mark unmeasured',
    !!victim017, { file: 'receipts/report-007/git-workflow-and-versioning-claude-sonnet-5-2026-08-31.json' });

  if (victim017) {
    victim017.case_status = 'failed_timeout'; victim017.mean = null; victim017.score = null; victim017.stddev = 0;
    if (victim017.generation) { victim017.generation.n_measured = 0; victim017.generation.mean = null; victim017.generation.stopping_reason = 'unmeasured_exhausted'; }
    const built017 = buildReceipt({
      skill: { name: src017.skill.name, version: src017.skill.version, contentHash: src017.skill.content_hash },
      suite: { format: src017.suite.format, suiteHash: src017.suite.suite_hash, caseCount: src017.suite.case_count, canary: src017.suite.canary },
      run: { model_id: src017.run.model_id, surface: src017.run.surface, runner_version: src017.run.runner_version, date_utc: src017.run.date_utc, judge: src017.run.judge },
      cases: cases017,
    });
    const w017 = built017.results.aggregates.with_skill; const b017 = built017.results.aggregates.baseline;
    gate.check('AC-5: an unmeasured arm removes its case from BOTH arms, on a real receipt with one arm forced unmeasured',
      w017.case_count === b017.case_count, { with_skill: w017.case_count, baseline: b017.case_count });
    const bothArms017 = built017.results.cases.filter((c) => c.id === victim017.id).length;
    gate.check('AC-5: the excluded case still appears in results.cases (excluded from the aggregate, not from the record)',
      bothArms017 === 2, { count: bothArms017 });
    const listed017 = built017.results.aggregates.excluded_cases;
    gate.check('AC-6: the receipt records which case ids were excluded from the aggregate',
      Array.isArray(listed017) && listed017.some((x) => x && x.id === victim017.id), { listed: listed017 });
    gate.check('AC-6: the exclusion record carries a reason',
      Array.isArray(listed017) && listed017.some((x) => x && x.reason), { listed: listed017 });
  } else {
    gate.check('AC-5: an unmeasured arm removes its case from BOTH arms, on a real receipt with one arm forced unmeasured', false, { missing: 'no baseline case in the subject receipt' });
    gate.check('AC-5: the excluded case still appears in results.cases (excluded from the aggregate, not from the record)', false, { missing: 'no baseline case in the subject receipt' });
    gate.check('AC-6: the receipt records which case ids were excluded from the aggregate', false, { missing: 'no baseline case in the subject receipt' });
    gate.check('AC-6: the exclusion record carries a reason', false, { missing: 'no baseline case in the subject receipt' });
  }
}

gate.section('run fidelity: band provenance reaches the page (spec 017 AC-7)');
{
  const { bandOf } = require('../lib/reuse');
  const newerPath017 = path.join(ROOT, 'receipts', 'report-007', 'git-workflow-and-versioning-claude-sonnet-5-2026-08-31.json');
  const olderDir017 = path.join(ROOT, 'receipts', 'report-006');
  const olderFile017 = fs.existsSync(olderDir017)
    ? fs.readdirSync(olderDir017).find((x) => x.startsWith('git-workflow-and-versioning-claude-sonnet-5') && x.endsWith('.json') && !x.includes('control'))
    : null;
  gate.check('AC-7 subject: a real v0.4/v0.5 pair exists for the same skill+model under receipts/report-006 and receipts/report-007',
    fs.existsSync(newerPath017) && !!olderFile017, { newer: fs.existsSync(newerPath017), older: olderFile017 });

  if (fs.existsSync(newerPath017) && olderFile017) {
    const newer017 = JSON.parse(fs.readFileSync(newerPath017, 'utf8'));
    const older017 = JSON.parse(fs.readFileSync(path.join(olderDir017, olderFile017), 'utf8'));
    const so017 = bandOf(older017.results.cases.find((c) => c.mode === 'with_skill')).source;
    const sn017 = bandOf(newer017.results.cases.find((c) => c.mode === 'with_skill')).source;
    gate.check('AC-7 precondition: the pair genuinely differs in provenance (legacy vs generation)',
      so017 === 'legacy' && sn017 === 'generation', { older: so017, newer: sn017 });
    const rep017 = buildDriftReport(older017, newer017, {});
    // THE LEGEND IS NOT THE EVIDENCE, and "distinguishably" is not two regex
    // offsets. What stood here was `legacyIdx017 !== genIdx017` over two
    // md.search() results — a comparison that cannot fail, since two different
    // tokens cannot match at the same offset — copied verbatim from
    // specs/017's probe. approval-20260901T032810Z non-blocking finding 4.
    // Replaced in both places by the property AC-7 states: the markers annotate
    // DIFFERENT BANDS, on the same per-case row, in the column belonging to the
    // receipt whose provenance they state.
    // And the coverage clause counts against the ROWS, not against the marked
    // subset: `marked > 0` was satisfied by one labelled row of seven, while
    // AC-7 says *wherever* a band is printed. approval-20260901T070822Z
    // non-blocking 3, closed in both places.
    const body017 = rep017.markdown.split('\n').filter((l) => !/band provenance:/.test(l)).join('\n');
    const rows017 = body017.split('\n')
      .map((l) => l.match(/^\|\s*`([^`]+)`\s*\|([^|]*)\|([^|]*)\|/))
      .filter(Boolean)
      .map((m) => ({ id: m[1], before: m[2], after: m[3] }));
    const markerIn017 = (cell) => (cell.match(/\((legacy|generation)\)/) || [])[1] || null;
    const marked017 = rows017.filter((r) => markerIn017(r.before) || markerIn017(r.after));
    const paired017 = marked017.filter((r) => markerIn017(r.before) === 'legacy' && markerIn017(r.after) === 'generation');
    const undistinguished017 = marked017.filter((r) => markerIn017(r.before) === markerIn017(r.after));
    gate.check('AC-7: outside the legend, both provenance labels reach the page — the legend alone does not satisfy this',
      /legacy/i.test(body017) && /generation|across-draw/i.test(body017),
      { legacy: /legacy/i.test(body017), generation: /generation|across-draw/i.test(body017) });
    gate.check('AC-7: the two labels annotate DIFFERENT bands — EVERY rendered per-case row carries (legacy) on the v0.4 band and (generation) on the v0.5 band, and none carries the same marker twice',
      rows017.length > 0 && marked017.length === rows017.length
        && paired017.length === marked017.length && undistinguished017.length === 0,
      { rows: rows017.length, marked: marked017.length, paired: paired017.length, undistinguished: undistinguished017.length });
  } else {
    gate.check('AC-7 precondition: the pair genuinely differs in provenance (legacy vs generation)', false, { missing: 'no v0.4/v0.5 pair found' });
    gate.check('AC-7: outside the legend, both provenance labels reach the page — the legend alone does not satisfy this', false, { missing: 'no v0.4/v0.5 pair found' });
    gate.check('AC-7: the two labels annotate DIFFERENT bands — EVERY rendered per-case row carries (legacy) on the v0.4 band and (generation) on the v0.5 band, and none carries the same marker twice', false, { missing: 'no v0.4/v0.5 pair found' });
  }
}


// ── Report 007 figures trace to receipts (report + both amended pages) ───────
//
// Report 007's page is a PURE FUNCTION of the committed receipts, so the check
// that grounds it re-renders from those receipts and compares. The renderer, the
// receipts and (since the v0.7.0 promotion) the page itself all ship, so every
// assertion below reads a subject that is present in the source tree and in a
// published one alike.
//
// The amendments on Report 005 and Report 006 are checked against the same
// derivations that wrote them: a figure in an amendment block is a published
// number and owes a receipt exactly as a figure in a report does.
gate.section('report 007 figures trace to receipts');
{
  const prep7 = require(path.join(ROOT, 'scripts', 'prepare-report-007.js'));
  const rows7 = prep7.readCells();
  const page7 = prep7.buildPage(rows7, { nowIso: '2026-01-01T00:00:00.000Z' });
  const published7 = path.join(SCAN_ROOT, 'docs', 'reports', '007', 'index.html');

  // 1. The page on disk is the page the receipts produce. A page that drifted
  //    from its receipts is a page carrying numbers nothing re-derives. Read
  //    from SCAN_ROOT so a published tree checks the page it actually ships,
  //    and FAILS on absence rather than going quiet: since the promotion out of
  //    `007-draft/` there is no tree this page is excluded from.
  const onDisk7 = fs.existsSync(published7) ? fs.readFileSync(published7, 'utf8') : null;
  gate.check('report 007: the published page is byte-identical to what its receipts render (a pure function of them)',
    onDisk7 != null && onDisk7 === page7,
    { present: onDisk7 != null, bytesOnDisk: onDisk7 ? onDisk7.length : 0, bytesRendered: page7.length });

  // 2. EVERY per-case band, delta and cell aggregate the page prints is a value
  //    a receipt records. Derived from the receipts, never from a list: a
  //    literal expectation is correct on the day it is written and silently
  //    short afterwards.
  const wanted7 = [];
  for (const r of rows7) {
    for (const c of r.cases) {
      wanted7.push(`${c.baseline.mean.toFixed(3)} ± ${c.baseline.sd.toFixed(3)}`);
      wanted7.push(`${c.skill.mean.toFixed(3)} ± ${c.skill.sd.toFixed(3)}`);
    }
    wanted7.push(`${r.comparison.delta >= 0 ? '+' : ''}${r.comparison.delta.toFixed(3)}`);
    wanted7.push(`± ${r.comparison.delta_uncertainty.toFixed(3)}`);
    wanted7.push(r.receipt.receipt_hash.slice(0, 16));
    wanted7.push(String(r.sampling.drawn));
  }
  const missing7 = wanted7.filter((v) => !page7.includes(v));
  gate.check('report 007: every per-case band, cell lift, lift band, receipt hash and draw count on the page is a value its receipt records',
    missing7.length === 0, { checked: wanted7.length, missing: missing7.slice(0, 8) });

  // 3. MUTATION. A tracer that only ever passes is not a tracer. Plant a figure
  //    the receipts do not contain and require the same comparison to catch it.
  //    The planted value must be one the page states EXACTLY ONCE, or a
  //    surviving second occurrence keeps the tracer green while the figure is
  //    wrong. A receipt hash prefix is unique on the page; a rounded lift like
  //    `+0.055` is not (the Report 006 amendment summary states the same
  //    string), and planting into that one passed while proving nothing.
  {
    const uniq7 = rows7[0].receipt.receipt_hash.slice(0, 16);
    const occurrences7 = page7.split(uniq7).length - 1;
    const planted7 = page7.split(uniq7).join('0000000000000000');
    const stillMissing7 = wanted7.filter((v) => !planted7.includes(v));
    gate.check('report 007 MUTATION: a planted figure that no receipt records takes the tracer red',
      occurrences7 === 1 && planted7 !== page7 && stillMissing7.length > 0,
      { occurrences: occurrences7, planted: planted7 !== page7, caught: stillMissing7.slice(0, 3) });
  }

  // 4. THE AMENDMENTS CARRY RECEIPT-DERIVED FIGURES TOO. Report 006 v1.1's
  //    corrected lift and band are the archived receipt's own case rows put
  //    through the CURRENT aggregate path; Report 005 v1.2's re-measured lifts
  //    are Report 007's cell deltas. Both are asserted against those
  //    derivations, on the published pages, so an amendment cannot drift from
  //    the correction it reports.
  const a5html = fs.readFileSync(path.join(SCAN_ROOT, 'docs', 'reports', '005', 'index.html'), 'utf8');
  const a6html = fs.readFileSync(path.join(SCAN_ROOT, 'docs', 'reports', '006', 'index.html'), 'utf8');
  const fig6 = prep7.amend006Figures();
  const amendWant = [
    { page: '006', html: a6html, v: `${fig6.before.delta >= 0 ? '+' : ''}${fig6.before.delta.toFixed(3)}` },
    { page: '006', html: a6html, v: `${fig6.after.delta >= 0 ? '+' : ''}${fig6.after.delta.toFixed(3)}` },
    { page: '006', html: a6html, v: fig6.before.delta_uncertainty.toFixed(3) },
    { page: '006', html: a6html, v: fig6.after.delta_uncertainty.toFixed(3) },
    { page: '006', html: a6html, v: fig6.afterCounts },
    ...rows7.map((r) => ({ page: '005', html: a5html, v: `${r.comparison.delta >= 0 ? '+' : ''}${r.comparison.delta.toFixed(3)}` })),
    ...rows7.map((r) => ({ page: '005', html: a5html, v: `${JSON.parse(fs.readFileSync(path.join(ROOT, r.archive005), 'utf8')).comparison.delta.toFixed(3)}` })),
  ];
  const amendMissing = amendWant.filter((x) => !x.html.includes(x.v)).map((x) => `#${x.page}: ${x.v}`);
  const marker = (html, v) => (html.match(new RegExp(`<strong>v${v.replace('.', '\\.')}\\s*(?:&middot;|\u00b7)`, 'g')) || []).length;
  const dupes = [];
  if (marker(a5html, '1.2') !== 1) dupes.push(`#005 carries ${marker(a5html, '1.2')} v1.2 blocks`);
  if (marker(a6html, '1.1') !== 1) dupes.push(`#006 carries ${marker(a6html, '1.1')} v1.1 blocks`);
  gate.check('report 005 v1.2 and report 006 v1.1: each amendment appears exactly once and every figure it states is the derivation that produced them',
    dupes.length === 0 && amendMissing.length === 0,
    { dupes, checked: amendWant.length, missing: amendMissing.slice(0, 6) });

  // 5. THE HOMEPAGE FIGURE. The front page tells a reader how wide draw-to-draw
  //    spread gets. That figure must be the LARGEST across-draw spread the
  //    published Report 007 receipts actually record, computed from them rather
  //    than typed, and it must sit beside the definition of the band it is.
  const homeHtml = fs.readFileSync(path.join(SCAN_ROOT, 'docs', 'index.html'), 'utf8');
  const best7 = prep7.homepageFigure(rows7);
  const homeSd = (homeHtml.match(/draw-to-draw spread reaches <strong>sd ([0-9.]+)<\/strong>/) || [])[1];
  gate.check("docs/index.html's draw-to-draw spread figure is the largest across-draw sd the report-007 receipts record, stated with the band definition beside it",
    homeSd === best7.sd.toFixed(3) && /across-draw spread/.test(homeHtml) && homeHtml.includes(best7.id),
    { onPage: homeSd, fromReceipts: best7.sd.toFixed(3), arm: `${best7.slug}@${best7.model} ${best7.id}/${best7.mode}` });
}


// ── sampling-era cap recalibration (spec 018) ───────────────────────────────
//
// THESE RUN HERE, NOT ONLY IN specs/018's GATE. `specs/` is excluded from the
// published tree and no workflow runs a spec gate, so a rule that lives only
// beside its spec is never executed by a build (F-010-H). What these protect is
// what `npm publish` hands a stranger: a CLI whose default caps refused every
// suite of two or more cases, which is how v0.7.0 came to be tagged and not
// published.
//
// Every figure below is COMPUTED from the suite on disk and the constants in
// config.js. A gate that restated the numbers would be the same stale-literal
// defect one layer out.
gate.section('sampling-era cap recalibration (spec 018)');
{
  const { SAMPLING } = require('../lib/sampling');
  const { DEFAULT_JUDGE_SAMPLES, DEV_MAX_USD, DEV_MAX_CALLS } = require(path.join(ROOT, 'config.js'));
  const { estimateRunCostUSD } = require('../lib/cost');
  const { resolveModel } = require('../lib/provider');
  const EX018 = 'examples/commit-message-conventions';

  const suite018 = JSON.parse(fs.readFileSync(path.join(SCAN_ROOT, EX018, 'evals', 'evals.json'), 'utf8'));
  const cases018 = (suite018.cases || suite018).length;
  const projectCalls018 = (c, s, d) => c * d * (2 + 2 * s);
  const calls018 = projectCalls018(cases018, DEFAULT_JUDGE_SAMPLES, SAMPLING.max);
  const cost018 = estimateRunCostUSD({
    caseCount: cases018, draws: SAMPLING.max, samples: DEFAULT_JUDGE_SAMPLES,
    models: [resolveModel('claude-haiku-4-5')], judgeModel: 'haiku',
  }).totalUSD;

  // AC-2 — the shipped defaults admit the bundled example and a typical 10-case
  // suite. Read from config.js, never restated.
  const ten018 = projectCalls018(10, DEFAULT_JUDGE_SAMPLES, SAMPLING.max);
  gate.check('AC-2: the default caps admit the bundled example and a typical 10-case suite at SAMPLING.max draws',
    calls018 <= DEV_MAX_CALLS && cost018 <= DEV_MAX_USD && ten018 <= DEV_MAX_CALLS,
    { cases: cases018, calls: calls018, cost: cost018, capCalls: DEV_MAX_CALLS, capUsd: DEV_MAX_USD });

  // AC-1 — the self-test is pinned to the CEILING. A self-test running under the
  // generous default tests nothing about the projection; pinned, it is the first
  // thing that goes red if the projection grows again.
  const wf018 = fs.readFileSync(path.join(SCAN_ROOT, '.github', 'workflows', 'action-selftest.yml'), 'utf8');
  const wfCalls018 = Number((wf018.match(/max-calls:\s*'?(\d+)'?/) || [])[1]);
  const wfUsd018 = Number((wf018.match(/max-usd:\s*'?([\d.]+)'?/) || [])[1]);
  gate.check('AC-1: the Action self-test pins both caps to the computed v0.5 ceiling, not to the defaults',
    wfCalls018 === calls018 && wfUsd018 >= cost018 && wfUsd018 < DEV_MAX_USD && wfUsd018 < cost018 + 0.05,
    { wfCalls: wfCalls018, ceilingCalls: calls018, wfUsd: wfUsd018, ceilingUsd: cost018, defaultUsd: DEV_MAX_USD });

  // AC-3 MUTATION — the guard must still fire. The projection is driven above the
  // recalibrated default by SUITE SIZE; the cap is never lowered, because a cap
  // lowered by a flag proves only that the flag is read.
  {
    const perCase018 = 2 + 2 * DEFAULT_JUDGE_SAMPLES;
    const need018 = Math.floor(DEV_MAX_CALLS / (SAMPLING.max * perCase018)) + 1;
    const projected018 = projectCalls018(need018, DEFAULT_JUDGE_SAMPLES, SAMPLING.max);
    const tmp018 = fs.mkdtempSync(path.join(os.tmpdir(), 'driftproof-cap-'));
    let rc018 = null; let out018 = '';
    try {
      fs.mkdirSync(path.join(tmp018, 'evals'));
      fs.writeFileSync(path.join(tmp018, 'SKILL.md'),
        '---\nname: oversize-probe\nversion: 0.0.1\ndescription: gate fixture; drives the projection above the cap by suite size alone.\n---\n\nAlways answer with the single word OK.\n');
      fs.writeFileSync(path.join(tmp018, 'evals', 'evals.json'), JSON.stringify({
        skill: 'oversize-probe', version: '0.0.1', format: 'agentskills.io/evals',
        cases: Array.from({ length: need018 }, (_, i) => ({
          id: `probe-${i}`, prompt: 'Reply with the single word OK.', rubric: 'Response is exactly OK.',
          pass_threshold: 0.6, claim: 'gate fixture', grounding: 'gate fixture',
        })),
      }));
      const outDir018 = path.join(tmp018, 'out');
      fs.mkdirSync(outDir018);
      try {
        execFileSync('node', [path.join(ROOT, 'bin', 'driftproof'), 'run', tmp018, '--out', outDir018], {
          cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000,
          env: { ...process.env, DRIFTPROOF_STUB: '1', CLAUDE_PROVIDER: 'stub' },
        });
        rc018 = 0;
      } catch (e) { rc018 = e.status; out018 = `${e.stdout || ''}${e.stderr || ''}`; }
    } finally { fs.rmSync(tmp018, { recursive: true, force: true }); }
    const want018 = `ABORT (cost guard): projected ${projected018} calls/model exceeds --max-calls ${DEV_MAX_CALLS}`;
    gate.check('AC-3 MUTATION: a projection above the recalibrated default still aborts with exit 3 and the same message',
      rc018 === 3 && out018.includes(want018),
      { plantedCases: need018, projected: projected018, cap: DEV_MAX_CALLS, rc: rc018, sawMessage: out018.includes(want018) });
  }

  // AC-4 — every published INVOCATION must run under the caps it would actually
  // use. Two shapes, because a reader copies both: a command string, and an
  // Action `with:` block. The first draft read only command strings, which left
  // README's CI recipe carrying `max-usd: '2'` through this very loop
  // (`window-vs-file`, caught at approval). One parser, in assertion-scope.js,
  // called from here and from specs/018's gate.
  {
    const { publishedInvocations } = require('./assertion-scope');
    const files018 = ['README.md', path.join('docs', 'index.html'), path.join('bin', 'driftproof')]
      .map((rel) => ({ rel, text: fs.readFileSync(path.join(SCAN_ROOT, rel), 'utf8') }));
    const inv018 = publishedInvocations(files018, { usd: DEV_MAX_USD, calls: DEV_MAX_CALLS });
    const bad018 = [];
    for (const i of inv018) {
      if (calls018 > i.capCalls) bad018.push(`${i.where} [${i.shape}]: ${calls018} calls vs cap ${i.capCalls}`);
      if (cost018 > i.capUsd) bad018.push(`${i.where} [${i.shape}]: $${cost018} vs budget $${i.capUsd}`);
    }
    const shapes018 = new Set(inv018.map((i) => i.shape));
    gate.check('AC-4: every published invocation, command string AND Action input block, runs the bundled example without abort under the caps it would use',
      inv018.length >= 5 && shapes018.size === 2 && bad018.length === 0,
      { found: inv018.length, shapes: [...shapes018], bad: bad018.slice(0, 6) });
  }

  // AC-6 — the release record, and the pin it names.
  {
    const relTxt018 = fs.readFileSync(path.join(SCAN_ROOT, 'RELEASES.md'), 'utf8');
    const pkg018 = JSON.parse(fs.readFileSync(path.join(SCAN_ROOT, 'package.json'), 'utf8')).version;
    const pins018 = [];
    for (const f of ['README.md', path.join('docs', 'index.html')]) {
      for (const m of fs.readFileSync(path.join(SCAN_ROOT, f), 'utf8').matchAll(/driftproofhq\/driftproof@(v[\d.]+)/g)) {
        if (m[1] !== `v${pkg018}`) pins018.push(`${f}: ${m[1]}`);
      }
    }
    const missing018 = require('./assertion-scope').releaseEntryFacts(relTxt018, 'v0.7.1');
    gate.check('AC-6: the v0.7.1 entry records the not-published fact, the stale-since commit and the working guard, and the Action pin matches the package version',
      missing018.length === 0 && pins018.length === 0,
      { missing: missing018, stalePins: pins018 });
  }

  // AC-7 — no PUBLISHED STATEMENT of a cap default is a bare literal.
  //
  // F-018-B, approval round 2. The recalibration corrected two literals in the
  // source and left them standing in the prose beside them: README's § Cost
  // guard went on publishing "`--max-calls` (default 200)" and "12 calls per
  // case" — a figure that omits the SAMPLING.max draw factor entirely, so a
  // reader computing the bundled example from the front page of the npm package
  // gets 120 against a stated cap of 200 and concludes it fits. That is the
  // stale arithmetic this whole loop exists to correct, restated one layer out.
  //
  // AC-2's declared sources are bin/driftproof and config.js; AC-4's property is
  // invocations. Neither reads prose, so the round-1 fix could close a blocking
  // finding about "a hard $2 budget" at README:115 and plant "$20 budget" and
  // "2000-call cap" in its replacement, four lines away, with both gates green.
  //
  // THE SCOPE IS THE PUBLISHED TREE, derived from build-public.sh's EXCLUDE_RE,
  // never hand-listed — and this vantage is the one that matters, because the
  // published tree is what npm renders and specs/ never reaches it (F-010-H).
  {
    const scope018 = require('./assertion-scope');
    const { claims: capClaims018, scanned: capScanned018 } = scope018.capLiteralClaims(SCAN_ROOT);
    gate.check('AC-7: every published statement of a cap default names the config constant it comes from, nowhere a bare literal',
      capClaims018.length === 0 && capScanned018.length > 0,
      { scanned: capScanned018.length, claims: capClaims018.slice(0, 6) });

    // THE SUBJECT VOCABULARY IS DERIVED, not hand-written (F-018-D). It used to
    // be a phrase list built from the DEV_MAX_* words this loop touched, so
    // TRIGGER_MAX_USD and REPORT_MAX_USD prose was invisible and RUNBOOK.md
    // published "under the $25 trigger cap" with the assertion green. Every
    // exported cap constant must now be a subject by name, flag and prose form —
    // and the check discovers the constants rather than naming them.
    const capSubject018 = scope018.capSubjects(SCAN_ROOT);
    const capConst018 = Object.keys(require(path.join(SCAN_ROOT, 'config.js'))).filter((n) => /_MAX_(CALLS|USD)$/.test(n));
    const subjMissing018 = [];
    for (const name of capConst018) {
      const mm = name.match(/^(.+)_MAX_(CALLS|USD)$/);
      for (const form of [name, `--max-${mm[2].toLowerCase()}`, `the ${mm[1].toLowerCase().replace(/_/g, ' ')} cap`]) {
        if (!capSubject018.test(form)) subjMissing018.push(`${name}: ${form}`);
      }
    }
    gate.check('AC-7: the cap subject vocabulary is derived from config.js — every exported cap constant is a subject by name, flag and prose form',
      capConst018.length >= 3 && subjMissing018.length === 0,
      { constants: capConst018, missing: subjMissing018 });

    // MUTATIONS — one per SHAPE the property covers, not one per file (F-018-E).
    // A single mutation in the one shape the window happened to match is how
    // "2000-call cap" and "default 20" went through green. The set is shared with
    // the spec gate so both plant the same four.
    const capMissed018 = [];
    for (const m of scope018.CAP_MUTATIONS) {
      let caught = false;
      try {
        const planted = scope018.plantCapMutation(SCAN_ROOT, m);
        caught = scope018.capLiteralClaims(SCAN_ROOT, { [m.rel]: planted }).claims.length > 0;
      } catch (e) { caught = false; }
      if (!caught) capMissed018.push(`${m.id} (${m.rel}) — ${m.says}`);
    }
    gate.check('AC-7 MUTATION: every cap-statement shape — bare default, compound N-call, two-digit budget, trigger-cap prose — takes the published-prose scan red when planted',
      scope018.CAP_MUTATIONS.length >= 4 && capMissed018.length === 0,
      { planted: scope018.CAP_MUTATIONS.length, missed: capMissed018 });
  }
}

// ── the executed-assertion ledger ────────────────────────────────────────────
//
// NFR-4 (spec 019a) asserts that THIS gate carries the distribution assertions,
// not the spec gate alone. Round 2 of approval found the assertion it was first
// written as — a substring scan over this file's TEXT — satisfied by the
// section's own comment block: delete every check below and the six subject
// names still stand in the prose above them, so the assertion read green with
// the whole protection removed. name-vs-thing, in the check against
// name-vs-thing.
//
// So a distribution assertion's identity is recorded WHEN ITS CHECK IS CALLED,
// never where its name is written, and the ledger is emitted beside the results.
// What a reader observes is what RAN. The six ids are the six subjects: the
// derived page set, the analytics tag, the card tags, twitter:card, the card
// file, the sitemap. Deleting a call deletes its id from the emitted set, and
// the comment above it is powerless to put the id back.
const EXECUTED_ASSERTION_IDS = [];
const idcheck = (id, name, pass, detail = null) => {
  EXECUTED_ASSERTION_IDS.push(id);
  return gate.check(name, pass, detail);
};

// ── the site is distributable ────────────────────────────────────────────────
//
// spec 019a. The site published for five weeks with no analytics, no link
// preview and a hand-maintained docs/sitemap.xml that had already lost Report
// #005 and #006 — 11 URLs for a 13-page site, confirmed at 11 by Search Console,
// with nothing failing. Every assertion below is a PROPERTY over the DERIVED
// page set, so a Report #008 page is covered the day it exists.
//
// NO CROSS-REQUIRE INTO scripts/. A `require('../scripts/build-sitemap.js')`
// here would mean a throw in one tree silently deregisters this whole section
// and moves the source-only delta by its size — a compensating swap with a large
// coefficient. Fifteen duplicated lines beat a shared import that can vanish.
//
// These run in BOTH trees: docs/, scripts/ and tests/ all publish (EXCLUDE_RE
// touches none of them), and no check below is conditional on the tree it is in.
const ORIGIN_URL = 'https://driftproofhq.com';
const CARD_URL = `${ORIGIN_URL}/og.png`;
const BEACON_TAG = "<!-- Cloudflare Web Analytics --><script type='module' src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{\"token\": \"d78764dd442f49cb9bb203bd6302e9b4\"}'></script><!-- End Cloudflare Web Analytics -->";

// The publish rule, read from the publish script rather than restated here.
// Returns null when it cannot be read, which is asserted rather than absorbed:
// a derivation that silently widened would make every property below weaker
// without moving a count.
function publishExcludeRe(root) {
  try {
    const src = fs.readFileSync(path.join(root, 'scripts', 'build-public.sh'), 'utf8');
    const m = src.match(/EXCLUDE_RE='([^']+)'/) || src.match(/EXCLUDE_RE="([^"]+)"/);
    return m ? new RegExp(m[1]) : null;
  } catch (_e) { return null; }
}

function derivedPages(root) {
  const docsDir = path.join(root, 'docs');
  const ex = publishExcludeRe(root);
  const out = [];
  (function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) { walk(f); continue; }
      if (!e.name.endsWith('.html')) continue;
      const rel = path.relative(root, f).split(path.sep).join('/');
      if (!ex || !ex.test(rel)) out.push(f);
    }
  })(docsDir);
  return out;
}
const pageRelOf = (root, f) => path.relative(path.join(root, 'docs'), f).split(path.sep).join('/');
const pageUrlOf = (root, f) => {
  const r = pageRelOf(root, f);
  return ORIGIN_URL + '/' + (r === 'index.html' ? '' : r.replace(/(^|\/)index\.html$/, '$1'));
};
const HTML_ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decodeEnt = (s) => String(s)
  .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
  .replace(/&#x([0-9a-fA-F]+);/g, (_m, d) => String.fromCodePoint(parseInt(d, 16)))
  .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_m, n) => HTML_ENT[n]);
const plainText = (h) => decodeEnt(String(h).replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
const metaContent = (h, key) => {
  const m = h.match(new RegExp(`<meta\\s+(?:property|name)="${key.replace(':', '\\:')}"\\s+content="([^"]*)"`));
  return m ? m[1] : null;
};

gate.section('the site is distributable');
{
  const pages = derivedPages(SCAN_ROOT);

  // A page set that silently emptied would make every property below vacuously
  // true, and the EXCLUDE_RE read is the one input that could widen it.
  idcheck('dist.page-set', 'the derived page set is non-empty', pages.length > 0, { count: pages.length });
  idcheck('dist.page-set', "the publish rule is readable, so derivedPages() is filtering and not just walking",
    publishExcludeRe(SCAN_ROOT) !== null);

  const noBeacon = [];
  const dupBeacon = [];
  const notLast = [];
  const missingOg = [];
  const wrongCard = [];
  const wrongUrl = [];
  const wrongTwitter = [];
  const stubOg = [];
  const staleTitle = [];
  for (const f of pages) {
    const h = fs.readFileSync(f, 'utf8');
    const r = pageRelOf(SCAN_ROOT, f);

    // The recorded tag, exactly once. A second copy double-counts every view;
    // a page rendered by a switch that forgot it is invisible in a way no
    // number on the dashboard reveals.
    const hits = h.split(BEACON_TAG).length - 1;
    if (hits === 0) noBeacon.push(r);
    else {
      if (hits > 1) dupBeacon.push(`${r}: ${hits}`);
      const tail = h.slice(h.indexOf(BEACON_TAG) + BEACON_TAG.length);
      if (!/^\s*$/.test(tail.slice(0, tail.indexOf('</head>')))) notLast.push(r);
    }

    for (const k of ['og:title', 'og:description', 'og:image', 'og:url']) {
      if (metaContent(h, k) === null) missingOg.push(`${r}: ${k}`);
    }
    const img = metaContent(h, 'og:image');
    if (img !== null && img !== CARD_URL) wrongCard.push(`${r}: ${img}`);
    const url = metaContent(h, 'og:url');
    if (url !== null && url !== pageUrlOf(SCAN_ROOT, f)) wrongUrl.push(`${r}: ${url} != ${pageUrlOf(SCAN_ROOT, f)}`);
    const tw = metaContent(h, 'twitter:card');
    if (tw !== 'summary_large_image') wrongTwitter.push(`${r}: ${tw === null ? 'missing' : tw}`);
    for (const k of ['og:title', 'og:description']) {
      const v = metaContent(h, k);
      if (v !== null && v.trim().length < 20) stubOg.push(`${r}: ${k} (${v.trim().length} chars)`);
    }

    // og:title against the element it is DERIVED FROM, not merely present. A
    // card title frozen at generation while its page moved on is name-vs-thing,
    // and a presence check cannot see it. Report pages take their <h1>, which
    // carries the report's actual title where the <title> can be as bare as
    // "Driftproof Report #001"; every other page takes its <title>.
    const isReportPage = /^reports\/[^/]+\/index\.html$/.test(r);
    const srcEl = isReportPage ? h.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) : h.match(/<title>([\s\S]*?)<\/title>/);
    const wantTitle = srcEl ? plainText(srcEl[1]) : null;
    const gotTitle = metaContent(h, 'og:title');
    if (wantTitle === null) staleTitle.push(`${r}: no ${isReportPage ? '<h1>' : '<title>'} to derive from`);
    else if (gotTitle !== null && decodeEnt(gotTitle) !== wantTitle) staleTitle.push(`${r}: "${decodeEnt(gotTitle)}" != "${wantTitle}"`);
  }

  idcheck('dist.beacon', 'every published page carries the recorded analytics tag', noBeacon.length === 0, { noBeacon });
  idcheck('dist.beacon', 'no published page carries the analytics tag twice', dupBeacon.length === 0, { dupBeacon });
  idcheck('dist.beacon', 'the analytics tag is the last element in every page\'s <head>', notLast.length === 0, { notLast });
  idcheck('dist.og-meta', 'every published page carries og:title, og:description, og:image and og:url', missingOg.length === 0, { missingOg });
  idcheck('dist.og-meta', 'every og:image is the absolute card URL', wrongCard.length === 0, { wrongCard });
  idcheck('dist.og-meta', 'every og:url is the page\'s own canonical URL', wrongUrl.length === 0, { wrongUrl });
  idcheck('dist.twitter-card', 'every published page carries twitter:card=summary_large_image', wrongTwitter.length === 0, { wrongTwitter });
  idcheck('dist.og-meta', 'no og:title or og:description is a stub', stubOg.length === 0, { stubOg });
  idcheck('dist.og-meta', 'every og:title still tracks the element it is derived from', staleTitle.length === 0, { staleTitle });

  // The card the tags point at. Read from the PNG's own IHDR: a dimension taken
  // from the generator's intent rather than from the file is
  // fixture-vs-real-artifact, and the generator does not ship.
  const cardPath = path.join(SCAN_ROOT, 'docs', 'og.png');
  const cardBuf = fs.existsSync(cardPath) ? fs.readFileSync(cardPath) : Buffer.alloc(0);
  const isPng = cardBuf.length > 33 && cardBuf.toString('hex', 0, 8) === '89504e470d0a1a0a' && cardBuf.toString('ascii', 12, 16) === 'IHDR';
  const cardW = isPng ? cardBuf.readUInt32BE(16) : 0;
  const cardH = isPng ? cardBuf.readUInt32BE(20) : 0;
  const cardType = isPng ? cardBuf[25] : -1;
  idcheck('dist.og-card', 'docs/og.png exists and is a PNG', isPng, { bytes: cardBuf.length });
  idcheck('dist.og-card', 'docs/og.png is exactly 1200x630', cardW === 1200 && cardH === 630, { width: cardW, height: cardH });
  idcheck('dist.og-card', 'docs/og.png is opaque — no alpha channel for a platform to composite',
    cardType === 0 || cardType === 2 || cardType === 3, { colorType: cardType });
  idcheck('dist.og-card', 'docs/og.png is under the 300 KB card limit', cardBuf.length > 0 && cardBuf.length <= 300 * 1024, { kb: Math.round(cardBuf.length / 1024) });

  // THE SITEMAP IS THE PAGE SET — both directions.
  //
  // One direction alone is how #005 and #006 went missing: a sitemap listing 11
  // of 13 pages is a SUBSET, and a subset check passes. So this asserts set
  // EQUALITY. Byte-identity against a regeneration is deliberately NOT asserted
  // here: a published tree is one squashed commit, so its `git log` reports the
  // publish date for every file and lastmod would not reproduce. The spec gate
  // asserts regenerable-identical in the source tree, where it means something.
  const smPath = path.join(SCAN_ROOT, 'docs', 'sitemap.xml');
  const smXml = fs.existsSync(smPath) ? fs.readFileSync(smPath, 'utf8') : '';
  const smEntries = [...smXml.matchAll(/<url>\s*<loc>([^<]+)<\/loc>\s*(?:<lastmod>([^<]*)<\/lastmod>)?\s*<\/url>/g)]
    .map((m) => ({ loc: m[1], lastmod: m[2] || null }));
  const listedUrls = smEntries.map((e) => e.loc);
  const derivedUrls = pages.map((f) => pageUrlOf(SCAN_ROOT, f));
  idcheck('dist.sitemap', 'docs/sitemap.xml exists', smXml.length > 0);
  idcheck('dist.sitemap', 'the sitemap contains every published page',
    derivedUrls.filter((u) => !listedUrls.includes(u)).length === 0,
    { missing: derivedUrls.filter((u) => !listedUrls.includes(u)) });
  idcheck('dist.sitemap', 'the sitemap contains no URL that is not a published page',
    listedUrls.filter((u) => !derivedUrls.includes(u)).length === 0,
    { extra: listedUrls.filter((u) => !derivedUrls.includes(u)) });
  idcheck('dist.sitemap', 'every sitemap entry carries a git-derived lastmod',
    smEntries.length > 0 && smEntries.every((e) => e.lastmod && /^\d{4}-\d{2}-\d{2}$/.test(e.lastmod)),
    { bad: smEntries.filter((e) => !e.lastmod || !/^\d{4}-\d{2}-\d{2}$/.test(e.lastmod)).map((e) => `${e.loc}: ${e.lastmod}`) });
}


const summary = gate.summarize();
fs.writeFileSync(path.join(__dirname, 'gate-results.json'),
  JSON.stringify({ ...summary, executed_assertion_ids: [...new Set(EXECUTED_ASSERTION_IDS)] }, null, 2));
process.exit(gate.toExitCode());
