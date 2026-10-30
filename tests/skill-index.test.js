// SPDX-License-Identifier: Apache-2.0
'use strict';

// Spec 267 (issue 267): the skill index, "Worth installing?" pages at /skills/. Each criterion has a
// reader here that shares no code with scripts/build-skill-index.mjs: the receipts, the manifest, the
// identity records and the registry are read again from disk, every row's words are rebuilt from spec
// 267's fixed texts, and the built pages are parsed on their own. The readers call the repository's
// existing definitions of a state or of the chrome (lib/plain.js, lib/verdict.js, lib/stale.js,
// scripts/model-names.js, lib/importers-harbor.js opposedToPublished, scripts/site-chrome.js
// applyChrome, scripts/build-head-tags.js organization, beaconFor and siteConfig), since the claim is
// that the pages say what those say.
//
// Inputs: every Driftproof receipt of Reports 009, 011, 013 and 014, copied to a temporary tree at
// their own paths with Report 009's identity records; the nine skill-placebo arms imported here from
// the 60 fixture trials of spec 266, with a HAND-MADE install record in skills.lock.json form (spec 267
// A-267-3, the ruling on TBD-7); and NVIDIA receipts that are HAND-MADE, SPEC 265 SHAPE (spec 267
// § What 267 relies on from spec 265's draft), each field as 265's importer writes it, so each
// validates against v0.13. Those are built below and never tracked. The skill-placebo identities are
// the test's own.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const nodeModule = require('node:module');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const BUILDER = path.join(ROOT, 'scripts', 'build-skill-index.mjs');
const SPEC = path.join(ROOT, 'specs', '267-skill-index');
const SP = path.join(__dirname, 'fixtures', 'harbor', 'skill-placebo');
const TRIALS = path.join(SP, 'trials');
const AT = '2026-10-14T12:00:00.000Z';
const BUILD_DATE = '2026-10-14';
const TMP_BASE = process.env.SPEC267_TMP || os.tmpdir();

const { plainOf, LABELS } = require('../lib/plain');
const { armOf } = require('../lib/verdict');
const { bandOf } = require('../lib/reuse');
const { advisories } = require('../lib/stale');
const { loadRegistry } = require('../lib/models');
const { sealReceipt, verifyReceiptHash, validateReceipt, comparisonOf } = require('../lib/receipt');
const { registryStatus } = require('../lib/models');
const { IMPORT_METHOD } = require('../lib/importers');
const { RECEIPT_SCHEMA_VERSION, RUNNER_VERSION } = require('../config');
const { importHarbor, opposedToPublished } = require('../lib/importers-harbor');
const { humanModelName, shortModelName, MODEL_ID_RE } = require('../scripts/model-names');
const { applyChrome } = require('../scripts/site-chrome');
const { organization, beaconFor, siteConfig } = require('../scripts/build-head-tags');
const { tokenize, escapeRegExp } = require('../scripts/html-text');

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const blobSha1 = (b) => crypto.createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex');
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const tmp = (tag) => fs.mkdtempSync(path.join(TMP_BASE, `spec267-${tag}-`));
const write = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };
const copy = (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); };
const cmp16 = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const loadBuilder = () => import(pathToFileURL(BUILDER).href);
const relOf = (f) => path.relative(ROOT, f).split(path.sep).join('/');
const walkJson = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walkJson(path.join(d, e.name)) : e.name.endsWith('.json') ? [path.join(d, e.name)] : []));

// ── the fixed texts (spec 267 § The fixed texts and § The page texts), copied from the spec ─────
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const signed = (x) => (x > 0 ? `+${x}` : `${x}`);
const n3 = (x) => (typeof x === 'number' ? x.toFixed(3) : 'no score');
const TX = {
  W1: (report) => `Measured by Driftproof, Report ${report}`,
  W2: 'Recomputed by Driftproof from skill-placebo\'s published trials',
  W3: 'Reported by NVIDIA in its benchmark card',
  H1: (r) => `Driftproof runner ${r.run.runner_version} on ${r.run.surface}`,
  H2: (r) => `${r.run.harness.name} ${r.run.harness.version}`,
  H3: (r) => `${r.run.harness.name}, version not stated`,
  R2: (w, b, t) => `Recomputed by Driftproof from skill-placebo's trial files: ${w} with the skill and ${b} without, on ${plural(t, 'task')}. The receipt is DECLARED, so Driftproof gives it no verdict.`,
  R3: (v) => `skill-placebo's own verdict: "${v}". It compares the skill with a placebo skill, on pass rate and cost; the figures in the result compare it with no skill, on reward.`,
  R4: (u, a) => `NVIDIA reported ${signed(u)} points overall (${a}).`,
  R5: (s, a) => `NVIDIA reported a score of ${s}% overall and no uplift figure (${a}).`,
  R6: (a) => `NVIDIA reported figures per dimension only (${a}).`,
  R7: 'The card prints each uplift as a bare percent and does not say whether it is points or a share of the baseline.',
  R8: (printed, a) => `NVIDIA reported ${printed} overall, unit not stated (${a}).`,
  attempts: (n) => (Number.isInteger(n) ? `${plural(n, 'attempt')} per task` : 'attempts per task not stated'),
  K1: (t, w, b) => `${plural(t, 'task')}; ${plural(w, 'run')} with the skill and ${b} without`,
  K2: (n) => `; ${plural(n, 'trial')} left out, each listed in the receipt`,
  K3: (t) => (Number.isInteger(t) ? `${plural(t, 'task')}, as printed` : 'tasks not stated'),
  T1: (iw, ow, ib, ob) => `${iw} input and ${ow} output tokens per call with the skill; ${ib} and ${ob} without.`,
  T2: (cw, cb, basis) => `${cw} US dollars per call with the skill, ${cb} without, ${basis}.`,
  T3: (w, b) => `${w} tokens with the skill and ${b} without, over all cases, as printed; the card gives no cost`,
  T4: 'token use not recorded',
  basis: { 'metered-equivalent': 'at list price from the receipt\'s price snapshot', 'source-list-price-estimate': 'the agent\'s own estimate at list price; a call is one trial' },
  F1: (verb, name, family, names) => `${verb} on ${name}. Registered ${family} models released after this run, as of the build date: ${names}.`,
  F2: (verb, name, family) => `${verb} on ${name}. The registry lists no ${family} model released after this run, as of the build date.`,
  F3: (verb, name) => `${verb} on ${name}. Freshness unknown: the registry has no release date for it.`,
  F4: (verb, id) => `${verb} on ${id}. Freshness unknown: the model is not in the registry.`,
  F5: 'Model not stated. Freshness unknown.',
  L1: (source, model, label) => `${source}, ${model}: ${label}.`,
  G1: (verb, name) => `${name}: worth installing? ${verb} results`,
  G2: (verb, id) => (id.path ? `Skill ${id.path} in ${id.owner}/${id.repo}.` : id.unit === 'plugin' ? `Plugin ${id.owner}/${id.repo}, ${verb.toLowerCase()} as one bundle.` : `Skill at the root of ${id.owner}/${id.repo}.`),
  G3: 'Each result has its own test record. Results are not combined.',
  G4: 'Worth installing?',
  G5: 'Browse skills and open their test results.',
  G6: 'Have a GitHub link to a skill? Look it up.',
  // G-6 as this file's page reader reads it: a tag is read as a space, so the link's closing tag
  // stands before the full stop (A-267-6).
  G6_READ: 'Have a GitHub link to a skill? Look it up .',
  S1: 'Receipts by Driftproof (driftproofhq/driftproof), licensed Apache-2.0.',
  S2: (commit) => `Trials from simonether/skill-placebo at commit ${commit}, licensed MIT.`,
  A1: (commit) => `Figures from NVIDIA/skills at commit ${commit}, licensed CC BY 4.0. Reformatted by Driftproof; NVIDIA does not endorse this page.`,
  D1: 'Disagree, or want a re-run?',
  B1: (date) => `Built on ${date} from committed receipts.`,
  P1: (verb, name, id, sources) => `${verb} results for ${name} (${id.owner}/${id.repo}) from ${sources}, one row per receipt, in plain words.`,
  P2: 'Agent skills: worth installing? | Driftproof',
  P3: 'We test AI skills on written tasks. See what helped, what hurt, and where more answers are needed.',
  NVLABEL: 'NVIDIA\'s figures',
  noCommit: 'skill commit not recorded',
};
const VERDICT_WORDS = [
  ...Object.values(LABELS).filter((l) => l !== LABELS.REPORTED),
  'passing', 'regressed', 'no effect', 'not enough draws', 'more cases needed', 'inconclusive',
  'Helps', 'Hurts', 'No clear difference', 'Not enough data to say', 'PASS', 'FAIL',
  'beats placebo', 'no better than placebo', 'worse than placebo',
];
// Spec 035 probes/surfaces.mjs LEX_EXTRA, the repository's reading of confidence language.
const CONFIDENCE = /\bconfiden(t|ce)\b|\bsignifican(t|ce)\b/i;
const BANNED = /\b(bad|broken|useless|fails)\b/i;
const FRESH_WORDS = /\b(current|up to date|latest)\b/i;
// A-267-5: the first field reads "Measured by" on a TESTED row and "Reported by" on any other.
const byField = (verb) => `${verb} by`;
const FIELDS_DP = (verb) => [byField(verb), 'Model', 'Date', 'Result', 'Tasks and runs', 'Receipt', 'Harness', 'Tokens', 'Freshness', 'Skill commit'];
const FIELDS_SP = (verb) => [byField(verb), 'Model', 'Date', 'Result', 'Tasks and runs', 'Receipt', 'Source\'s verdict', 'Harness', 'Tokens', 'Freshness', 'Skill commit'];
const SETS = { source: ['driftproof', 'skill-placebo', 'nvidia'], evidence: ['measured', 'recomputed', 'aggregates-only'], freshness: ['newer', 'no-newer', 'unknown'] };

// ── inputs ────────────────────────────────────────────────────────────────────────────────────
const REPORTS = ['009', '011', '013', '014'];
const DP_ALL = REPORTS.flatMap((n) => walkJson(path.join(ROOT, 'receipts', `report-${n}`)).map((f) => ({ file: relOf(f), report: n, name: readJson(f).skill.name })))
  .sort((a, b) => cmp16(a.file, b.file));
// Three of them name the states the plants need; each is in DP_ALL.
const DP = [
  { file: 'receipts/report-009/code-review-and-quality-claude-opus-5-2026-09-15.json', report: '009', name: 'code-review-and-quality' },
  { file: 'receipts/report-011/code-review-and-quality-claude-opus-5-5-2026-09-23.json', report: '011', name: 'code-review-and-quality' },
  { file: 'receipts/report-013/run-1/git-workflow-and-versioning-claude-sonnet-5-5-2026-09-29.json', report: '013', name: 'git-workflow-and-versioning' },
];
const PROTOCOL = 'docs/reports/009/evidence/three-skill-comparison--protocol.md';
const UPSTREAM = 'specs/034-report-009-three-skill-comparison/evidence/upstream-skill-sha256-20260915T185745Z.txt';
const PROTO = /Three skills from ([^/\s]+)\/(\S+) commit ([0-9a-f]{40}): ([^.\n]+)\./.exec(fs.readFileSync(path.join(ROOT, PROTOCOL), 'utf8'));
const DP_OWNER = PROTO[1]; const DP_REPO = PROTO[2]; const DP_COMMIT = PROTO[3];
const DP_NAMES = PROTO[4].split(',').map((s) => s.trim());
const DP_PATHS = new Map([...fs.readFileSync(path.join(ROOT, UPSTREAM), 'utf8').matchAll(/^(\S+) \| https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([0-9a-f]{40})\/(\S+)\/SKILL\.md \|/gm)]
  .map((m) => [m[1], { owner: m[2], repo: m[3], commit: m[4], path: m[5] }]));

const VERDICTS = readJson(path.join(SP, 'claude-code.json'));
const SP_IDS = {
  superpowers: ['test-owner-a', 'superpowers', 'plugin'], mattpocock: ['mattpocock', 'skills', 'plugin'], karpathy: ['test-owner-c', 'karpathy', 'skill'],
  ponytail: ['test-owner-d', 'ponytail', 'skill'], caveman: ['test-owner-e', 'caveman', 'skill'], 'agent-skills': ['test-owner-f', 'agent-skills', 'plugin'],
  'i-have-adhd': ['test-owner-g', 'i-have-adhd', 'skill'], 'planning-with-files': ['test-owner-b', 'planning-with-files', 'skill'], 'compound-engineering': ['test-owner-h', 'compound-engineering', 'plugin'],
};
const spArms = () => Object.keys(VERDICTS.comparisons).map((key) => {
  const [owner, repo, unit] = SP_IDS[key];
  return { key, arm: `skill-${key}`, name: repo, identity: { owner, repo, path: '', unit }, sha: sha256(`lock ${key}`).slice(0, 40) };
});
const SP_ARMS = spArms();
const SP_COMMIT = /commit\s+`([0-9a-f]{40})`/.exec(fs.readFileSync(path.join(SP, 'README.md'), 'utf8'))[1];
const SP_RECORD = 'index-receipts/skill-placebo/skills.lock.json';
// HAND-MADE install record in skills.lock.json form (spec 267 A-267-3, the ruling on TBD-7 (a)): one
// entry per arm id, its repository and its pinned commit.
const skillsLock = (arms) => `${JSON.stringify({ note: 'hand-made, spec 267 test', skills: arms.map((a) => ({ id: a.key, repo: `${a.identity.owner}/${a.identity.repo}`, sha: a.sha, latest_release: null, stars: 0, license: 'MIT' })) }, null, 2)}\n`;
const NV_COMMIT = 'f'.repeat(40); // hand-made: the draft fixtures' commit is 265's, read at its merge
const ALIASES = { 'aws/anthropic/bedrock-claude-opus-4-8': 'claude-opus-4-8', 'openai/openai/gpt-5.5': 'gpt-5.5' };

// HAND-MADE, SPEC 265 SHAPE: a receipt with every field lib/importers-nvidia.js cardReceipts writes,
// its case rows left out of both arms by the shared calculation, sealed so its hash verifies and
// validated against v0.13 (spec 267 AC-1). `skill` is the card's printed `- Skill:` value and
// `folder` its catalog folder (spec 267 A-267-2: the identity is the folder).
const NV_SCHEMA = readJson(path.join(ROOT, 'spec', 'receipt.v0.13.schema.json'));
const NV_SCHEMA_VERSION = NV_SCHEMA.properties.schema_version.const;
const NV_REASON = 'aggregates only: the source carries no per-run scores for this case, so no band can be formed';
function draftNvidia({ skill, folder = skill, agent, model, date, tasks, attempts, rows, tokens }) {
  const dims = rows.filter((r) => r.dimension !== 'Overall');
  const cases = dims.flatMap((d) => ['with_skill', 'baseline'].map((mode) => ({ id: `dimension:${d.dimension.toLowerCase()}`, mode, label: d.dimension, case_status: 'no_observations' })));
  const calculated = comparisonOf(cases, { reasons: Object.fromEntries(cases.map((_, i) => [i, NV_REASON])) });
  const r = {
    schema_version: NV_SCHEMA_VERSION,
    skill: { name: skill, version: 'unknown', content_hash: null },
    suite: { format: 'nvidia/benchmark-card', suite_hash: null, case_count: dims.length },
    run: {
      model_id: model, model_release_date: null, provider: model.includes('openai') ? 'openai' : model === 'unknown' ? 'unknown' : 'anthropic',
      surface: 'external', source: 'imported/nvidia-cards', runner_version: RUNNER_VERSION, date_utc: `${date}T00:00:00Z`,
      registry: registryStatus(model), transcripts: 'none',
      judge: { temperature: null, sampling: 'external', surface: 'external', model_id: 'unknown', prompt_template_hash: null },
      answered_by: { kind: 'external', attested: false, reported_model: null, reported_models: null, isolation: 'none' },
      harness: { name: agent, version: null },
      import: { tool: 'nvidia-cards', format: 'BENCHMARK.md', format_version: null, source_sha256: sha256(skill + agent), imported_at: AT, comparison_method: IMPORT_METHOD, sidecars: [{ file: 'benchmarks.json', sha256: 'c'.repeat(64) }], notices: ['hand-made, spec 267 test'] },
    },
    results: { cases, aggregates: calculated.aggregates },
    comparison: calculated.comparison,
    verification_level: 'DECLARED',
    uncertainty_unavailable: 'aggregates_only',
    source_figures: {
      agent, skill, evaluation_date: date, evaluator_version: null, environment: null, dataset_digest: null, tasks, attempts_per_task: attempts,
      source: { repo: 'NVIDIA/skills', commit: NV_COMMIT, files: [{ path: `skills/${folder}/BENCHMARK.md`, git_blob_sha1: 'a'.repeat(40) }, { path: 'benchmarks.json', git_blob_sha1: 'b'.repeat(40) }] },
      rows: rows.map((x) => ({ dimension: x.dimension, printed: x.printed, score_pct: x.score_pct, baseline_pct: x.baseline_pct ?? null, uplift: x.uplift, uplift_unit: x.uplift_unit, tasks: x.tasks ?? null })),
      tokens: tokens || null,
    },
    receipt_hash: '',
  };
  if (tokens) r.economics = { basis: 'source-reported', with_skill: { total_tokens: Number(tokens.with_skill.replace(/,/g, '')) }, baseline: { total_tokens: Number(tokens.without_skill.replace(/,/g, '')) }, judge_excluded: true };
  return sealReceipt(r);
}
const nvId = (skill) => ({ owner: 'NVIDIA', repo: 'skills', path: `skills/${skill}`, unit: 'skill' });
const NV = [
  { file: 'index-receipts/nvidia/newer-card-claude-code.json', name: 'newer-card', identity: nvId('newer-card'),
    receipt: () => draftNvidia({ skill: 'newer-card', agent: 'claude-code', model: 'aws/anthropic/bedrock-claude-opus-4-8', date: '2026-06-02', tasks: 12, attempts: 1,
      rows: [
        { dimension: 'Overall', printed: '40% → 78.4% (+38.4 points)', score_pct: 78.4, baseline_pct: 40, uplift: 38.4, uplift_unit: 'points' },
        { dimension: 'Correctness', printed: '51% → 84% (+33 points)', score_pct: 84, baseline_pct: 51, uplift: 33, uplift_unit: 'points' },
      ],
      tokens: { with_skill: '1,234,567', without_skill: '1,000,000', delta: '+234,567', change: '+23.5%', coverage: 'skill 12/12; base 12/12' } }) },
  { file: 'index-receipts/nvidia/older-card-claude-code.json', name: 'older-card', identity: nvId('older-card'),
    // Its card prints a name other than its folder, as the bionemo- cards do (A-267-2).
    receipt: () => draftNvidia({ skill: 'printed-elsewhere', folder: 'older-card', agent: 'claude-code', model: 'unknown', date: '2026-04-20', tasks: null, attempts: null,
      rows: [{ dimension: 'Correctness', printed: '84% (+33%)', score_pct: 84, uplift: 33, uplift_unit: 'unstated', tasks: 7 }] }) },
  { file: 'index-receipts/nvidia/older-overall-claude-code.json', name: 'older-overall', identity: nvId('older-overall'),
    receipt: () => draftNvidia({ skill: 'older-overall', agent: 'claude-code', model: 'unknown', date: '2026-04-21', tasks: null, attempts: null,
      rows: [{ dimension: 'Overall', printed: '70% (+20%)', score_pct: 70, uplift: 20, uplift_unit: 'unstated', tasks: 9 }, { dimension: 'Security', printed: '60% (+10%)', score_pct: 60, uplift: 10, uplift_unit: 'unstated', tasks: 9 }] }) },
  { file: 'index-receipts/nvidia/newer-card-codex.json', name: 'newer-card', identity: nvId('newer-card'),
    receipt: () => draftNvidia({ skill: 'newer-card', agent: 'codex', model: 'openai/openai/gpt-5.5', date: '2026-06-02', tasks: 12, attempts: 1,
      rows: [{ dimension: 'Overall', printed: '62%', score_pct: 62, uplift: null, uplift_unit: null }, { dimension: 'Correctness', printed: '62%', score_pct: 62, uplift: null, uplift_unit: null }] }) },
];

// A temporary tree with everything a build reads. `arms(list)` changes the skill-placebo arms before
// they are imported; `before(ws)` changes files or the manifest before sha256s and blob sha1s are
// taken; `after(ws)` tampers after.
function workspace({ arms, before, after } = {}) {
  const root = tmp('ws');
  const list = spArms();
  if (arms) arms(list);
  const manifest = {
    sources: [
      { id: 'driftproof', name: 'Driftproof', repo: 'driftproofhq/driftproof', commit: null, licence: 'Apache-2.0', identity_record: { protocol: PROTOCOL, upstream: UPSTREAM } },
      { id: 'skill-placebo', name: 'skill-placebo', repo: 'simonether/skill-placebo', commit: SP_COMMIT, licence: 'MIT', licence_file: 'index-receipts/skill-placebo/LICENSE',
        verdicts: { file: 'index-receipts/skill-placebo/claude-code.json', source_path: 'results/main/claude-code.json', git_blob_sha1: undefined },
        identity_record: { file: SP_RECORD, source_path: 'skills.lock.json', git_blob_sha1: undefined } },
      { id: 'nvidia', name: 'NVIDIA', repo: 'NVIDIA/skills', commit: NV_COMMIT, licence: 'CC-BY-4.0', licence_file: 'index-receipts/nvidia/LICENSE' },
    ],
    receipts: [],
    model_aliases: { ...ALIASES },
  };
  for (const rel of [PROTOCOL, UPSTREAM]) copy(path.join(ROOT, rel), path.join(root, rel));
  for (const d of DP_ALL) {
    copy(path.join(ROOT, d.file), path.join(root, d.file));
    const h = readJson(path.join(ROOT, d.file)).receipt_hash;
    write(path.join(root, 'docs', 'r', h, 'index.html'), '<!doctype html><title>receipt page stand-in</title>\n');
    const up = DP_PATHS.get(d.name);
    manifest.receipts.push({ source: 'driftproof', file: d.file, report: d.report, identity: { owner: DP_OWNER, repo: DP_REPO, path: up.path, unit: 'skill' }, name: d.name, skill_commit: DP_COMMIT });
  }
  for (const a of list) {
    const { receipt } = importHarbor({ withJob: path.join(TRIALS, a.arm), withoutJob: path.join(TRIALS, 'baseline'), skill: a.name, importedAt: AT });
    const file = `index-receipts/skill-placebo/${a.arm}.json`;
    write(path.join(root, file), JSON.stringify(receipt, null, 2));
    manifest.receipts.push({ source: 'skill-placebo', file, verdict_key: a.key, identity: { ...a.identity }, name: a.name, skill_commit: a.sha });
  }
  write(path.join(root, SP_RECORD), skillsLock(list));
  copy(path.join(SP, 'LICENSE'), path.join(root, 'index-receipts', 'skill-placebo', 'LICENSE'));
  copy(path.join(SP, 'claude-code.json'), path.join(root, 'index-receipts', 'skill-placebo', 'claude-code.json'));
  write(path.join(root, 'index-receipts', 'nvidia', 'LICENSE'), 'hand-made stand-in for the CC BY 4.0 legal code, spec 267 round 2\n');
  for (const n of NV) {
    write(path.join(root, n.file), JSON.stringify(n.receipt(), null, 2));
    manifest.receipts.push({ source: 'nvidia', file: n.file, identity: { ...n.identity }, name: n.name, skill_commit: NV_COMMIT });
  }
  const ws = { root, manifest, arms: list, file: (rel) => path.join(root, rel) };
  if (before) before(ws);
  for (const e of manifest.receipts) if (e.sha256 === undefined) e.sha256 = sha256(fs.readFileSync(ws.file(e.file)));
  for (const k of ['verdicts', 'identity_record']) {
    const v = manifest.sources[1][k];
    if (v.git_blob_sha1 === undefined) v.git_blob_sha1 = blobSha1(fs.readFileSync(ws.file(v.file)));
  }
  write(ws.file('index-receipts/sources.json'), JSON.stringify(manifest, null, 2));
  write(ws.file('index-receipts/README.md'), manifest.sources.map((s) => `- ${s.name}: ${s.repo}${s.commit ? ` at commit ${s.commit}; check a copy with git ls-tree ${s.commit} <path>` : ''}, licence ${s.licence}\n`).join(''));
  if (after) after(ws);
  return ws;
}
const reseal = (ws, rel, fn) => { const r = readJson(ws.file(rel)); fn(r); sealReceipt(r); write(ws.file(rel), JSON.stringify(r, null, 2)); };
const entryOf = (ws, rel) => ws.manifest.receipts.find((e) => e.file === rel);

async function build(ws, buildDate = BUILD_DATE) {
  const { buildSkillIndex } = await loadBuilder();
  const out = buildSkillIndex({ root: ws.root, buildDate });
  const files = new Map(out.files.map((f) => [f.path, Buffer.isBuffer(f.bytes) ? f.bytes : Buffer.from(f.bytes)]));
  return { files, held: out.held, pages: new Map([...files].filter(([p]) => p.endsWith('.html')).map(([p, b]) => [p, b.toString('utf8')])) };
}
function cli(args, env = {}) {
  return spawnSync(process.execPath, [BUILDER, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
}
function treeHash(dir) {
  if (!fs.existsSync(dir)) return 'absent';
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  return sha256(walk(dir).sort().map((f) => `${path.relative(dir, f)}\0${sha256(fs.readFileSync(f))}`).join('\n'));
}
// Refused through the function and through the CLI, with the reason on stderr and --out untouched.
async function refusesBoth(ws, re, buildDate = BUILD_DATE) {
  const { buildSkillIndex, SkillIndexRefused } = await loadBuilder();
  assert.throws(() => buildSkillIndex({ root: ws.root, buildDate }), (e) => e instanceof SkillIndexRefused && re.test(e.message), String(re));
  const out = path.join(ws.root, 'docs', 'skills');
  const before = treeHash(out);
  const r = cli(['--root', ws.root, '--out', out, '--build-date', buildDate]);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, re);
  assert.equal(treeHash(out), before);
}

// ── the page reader, sharing no code with the builder ─────────────────────────────────────────
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', rarr: '→', mdash: '—', ndash: '–', middot: '·' };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e] ?? m));
const textOf = (html) => decode(html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
function attrsOf(html) {
  const out = [];
  for (const tag of html.match(/<[a-z][^>]*>/gi) || []) for (const m of tag.matchAll(/\s([a-z-]+)\s*=\s*("([^"]*)"|'([^']*)')/gi)) out.push({ name: m[1].toLowerCase(), value: decode(m[3] ?? m[4]) });
  return out;
}
const titleOf = (html) => { const m = /<title>([\s\S]*?)<\/title>/i.exec(html); return m ? decode(m[1]).trim() : null; };
const descOf = (html) => { const m = /<meta\s+name="description"\s+content="([^"]*)"/i.exec(html); return m ? decode(m[1]) : null; };
const dataOf = (tag, k) => { const m = new RegExp(`\\sdata-${k}="([^"]*)"`).exec(tag); return m ? decode(m[1]) : null; };
const PAIR = /<dt>([\s\S]*?)<\/dt>\s*<dd>([\s\S]*?)<\/dd>/g;
function rowsOf(html) {
  const rows = [];
  for (const m of html.matchAll(/(<article\b[^>]*class="skill-row"[^>]*>)([\s\S]*?)<\/article>/g)) {
    const fields = {};
    const order = [];
    for (const f of m[2].matchAll(PAIR)) { const k = textOf(f[1]); fields[k] = { text: textOf(f[2]), html: f[2] }; order.push(k); }
    rows.push({ tag: m[1], html: m[0], inner: m[2], receipt: dataOf(m[1], 'receipt'), source: dataOf(m[1], 'source'), evidence: dataOf(m[1], 'evidence'), freshness: dataOf(m[1], 'freshness'), fields, order });
  }
  return rows;
}
// The text a row carries outside its <dt>/<dd> pairs (AC-5a): none.
const rowLoose = (row) => textOf(row.inner.replace(PAIR, ' ').replace('<summary>Receipt metadata</summary>', ' '));
function entriesOf(html) {
  return [...html.matchAll(/(<li\b[^>]*class="skill-entry"[^>]*>)([\s\S]*?)<\/li>/g)].map((m) => ({ tag: m[1], html: m[0], text: textOf(m[2]), page: dataOf(m[1], 'page'), source: dataOf(m[1], 'source'), evidence: dataOf(m[1], 'evidence'), freshness: dataOf(m[1], 'freshness'),
    // A-267-6 (issue 315): the identity's path, and each L-1 in its own <span class="skill-entry-row">.
    path: dataOf(m[1], 'path'), rows: [...m[2].matchAll(/<span class="skill-entry-row">([\s\S]*?)<\/span>/g)].map((r) => textOf(r[1])) }));
}
// Every string value of every JSON-LD block on a page.
function ldStrings(html) {
  const out = [];
  const walk = (v) => { if (typeof v === 'string') out.push(v); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
  for (const m of html.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) walk(JSON.parse(m[1]));
  return out;
}
// Every place a page carries words: its visible text, title, description, attribute values (href and src
// aside) and JSON-LD string values (AC-14, AC-24).
const partsOf = (html) => [textOf(html), titleOf(html) || '', descOf(html) || '', ...attrsOf(html).filter((a) => !['href', 'src'].includes(a.name)).map((a) => a.value), ...ldStrings(html)];
const stripBuildDate = (html) => html.replace(/<time data-build-date datetime="\d{4}-\d{2}-\d{2}">\d{4}-\d{2}-\d{2}<\/time>/g, '<time data-build-date></time>');
const SKELETON = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>t</title>\n</head>\n<body>\n<main></main>\n</body>\n</html>\n';
const mainOf = (html) => { const m = /<main\b[^>]*>([\s\S]*)<\/main>/.exec(html); return m ? m[1] : null; };
const outsideMain = (html) => textOf(html.replace(/<head>[\s\S]*?<\/head>/i, ' ').replace(/<main\b[\s\S]*<\/main>/, ' '));
// What the chrome alone writes at a path: outside <main>, and inside an empty <main>.
function chromeOf(p, headings = []) {
  const fixture = headings.map(x=>'<h2>'+x+'</h2>').join('');
  const h = applyChrome(SKELETON.replace('<main></main>','<main>'+fixture+'</main>'), `skills/${p}`);
  return { outside: outsideMain(h), inside: textOf((mainOf(h) || '').replace(/<h2\b[^>]*>[\s\S]*?<\/h2>/g,'')) };
}

// ── what each row and page should say, rebuilt from the receipt, the manifest and the registry ──
const pageName = (id) => (id.path ? id.path.split('/').pop() : id.repo);
const pagePath = (id) => `${id.owner}/${id.repo}/${pageName(id)}/index.html`;
const marked = (r) => r.uncertainty_unavailable !== undefined || r.source_figures !== undefined;
function tasksAndRuns(r) {
  const byId = new Map();
  for (const c of r.results.cases || []) { if (c.case_status && c.case_status !== 'ok') continue; const e = byId.get(c.id) || {}; e[c.mode] = c; byId.set(c.id, e); }
  let tasks = 0; let w = 0; let b = 0;
  // A task is a case whose two arms the verdict reads (armOf); its runs are the runs each row records
  // (bandOf: generation.n_measured, else one per sample, else 1).
  const runs = (row) => { const band = bandOf(row); return band.source === 'generation' ? band.n : Number.isInteger(band.n) && band.n > 0 ? band.n : 1; };
  for (const [, e] of byId) { const aw = armOf(e.with_skill); const ab = armOf(e.baseline); if (!aw || !ab) continue; tasks++; w += runs(e.with_skill); b += runs(e.baseline); }
  const left = (r.results.cases || []).reduce((s, c) => s + (Array.isArray(c.excluded_draws) ? c.excluded_draws.length : 0), 0);
  return { tasks, w, b, left };
}
function freshnessOf(r, aliases, adv = advisories) {
  const id = r.run.model_id;
  const verb = verbOf(r);
  if (id === 'unknown') return { text: TX.F5, value: 'unknown' };
  const regId = aliases[id] || id;
  const reg = loadRegistry();
  const row = reg.byId[regId];
  if (!row) return { text: TX.F4(verb, id), value: 'unknown' };
  if (!(typeof row.released === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.released))) return { text: TX.F3(verb, shortModelName(regId)), value: 'unknown' };
  const newer = adv({ run: { model_id: regId, date_utc: r.run.date_utc } }).slice().sort((a, b) => cmp16(a.released, b.released) || cmp16(a.model_id, b.model_id));
  if (!newer.length) return { text: TX.F2(verb, shortModelName(regId), row.family), value: 'no-newer' };
  return { text: TX.F1(verb, shortModelName(regId), row.family, newer.map((m) => shortModelName(m.model_id)).join(', ')), value: 'newer' };
}
function modelOf(r, aliases) {
  const id = r.run.model_id;
  if (id === 'unknown') return 'model not stated';
  if (aliases[id]) return `${humanModelName(aliases[id])} (${id}, as the source names it)`;
  try { return `${humanModelName(id)} (${id})`; } catch { return id; }
}
function nvidiaHead(sf) {
  const a = TX.attempts(sf.attempts_per_task);
  const overall = sf.rows.find((x) => x.dimension === 'Overall');
  if (!overall) return TX.R6(a);
  if (overall.uplift_unit === 'points' && typeof overall.uplift === 'number') return TX.R4(overall.uplift, a);
  if (overall.uplift_unit === 'unstated') return TX.R8(overall.printed, a);
  if (overall.uplift === null && typeof overall.score_pct === 'number') return TX.R5(overall.score_pct, a);
  return null;
}
function expectedRow(entry, r, ctx) {
  const src = entry.source;
  const out = {};
  out[byField(verbOf(r))] = src === 'driftproof' ? TX.W1(entry.report) : src === 'skill-placebo' ? TX.W2 : TX.W3;
  out.Model = modelOf(r, ctx.aliases);
  out.Harness = src === 'driftproof' ? TX.H1(r) : r.run.harness && r.run.harness.version ? TX.H2(r) : TX.H3(r);
  out.Date = r.run.date_utc.slice(0, 10);
  if (marked(r)) {
    const sf = r.source_figures;
    out['Tasks and runs'] = TX.K3(sf.tasks);
    const parts = [nvidiaHead(sf)];
    if (sf.rows.some((x) => x.uplift_unit === 'unstated')) parts.push(TX.R7);
    parts.push('Dimension Printed cell');
    for (const x of sf.rows) parts.push(`${x.dimension}: ${x.printed}`);
    out.Result = parts.join(' ');
    out.Tokens = sf.tokens ? TX.T3(sf.tokens.with_skill, sf.tokens.without_skill) : TX.T4;
  } else {
    const k = tasksAndRuns(r);
    out['Tasks and runs'] = TX.K1(k.tasks, k.w, k.b) + (k.left ? TX.K2(k.left) : '');
    const p = plainOf(r);
    if (r.verification_level === 'TESTED') out.Result = [p.sentence, p.detail, p.why].filter(Boolean).join(' ');
    else out.Result = [`${LABELS.REPORTED}.`, TX.R2(n3(r.comparison.with_skill_score), n3(r.comparison.baseline_score), k.tasks)].join(' ');
    if (src === 'skill-placebo') out['Source\'s verdict'] = TX.R3(ctx.verdicts.comparisons[entry.verdict_key].verdict);
    const e = r.economics;
    const fig = e && e.with_skill && e.baseline ? [e.with_skill.mean_input_tokens, e.with_skill.mean_output_tokens, e.baseline.mean_input_tokens, e.baseline.mean_output_tokens] : [null];
    if (fig.some((x) => typeof x !== 'number')) out.Tokens = TX.T4;
    else {
      const cw = e.with_skill.mean_cost_usd_per_call; const cb = e.baseline.mean_cost_usd_per_call;
      out.Tokens = [TX.T1(...fig.map((x) => String(Math.round(x)))), ...(typeof cw === 'number' && typeof cb === 'number' ? [TX.T2(cw.toFixed(4), cb.toFixed(4), TX.basis[e.basis])] : [])].join(' ');
    }
    // A-267-21 (issue 439): T-5, a row with a Driftproof verdict ends the field with spec 077's cost
    // sentence for its receipt, read from spec 077's oracle, when that reading shows one.
    if (evidenceOf(r) === 'measured') { const t5 = T5(r); if (t5) out.Tokens = `${out.Tokens} ${t5}`; }
  }
  out.Freshness = freshnessOf(r, ctx.aliases, ctx.advisories).text;
  out['Skill commit'] = entry.skill_commit || TX.noCommit;
  out.Receipt = path.basename(entry.file);
  return out;
}
const evidenceOf = (r) => (marked(r) ? 'aggregates-only' : r.verification_level === 'TESTED' ? 'measured' : 'recomputed');
// A-267-21 (issue 439): T-5 is spec 077's capitalised cost sentence, from its oracle, given the two
// outside facts that oracle names (the seal, and a Report 015 scope limit).
const COST077 = require('../specs/077-cost-next-to-lift/reading.js');
function T5(r) {
  const sealed = (() => { try { return require('../lib/receipt').verifyReceiptHash(r); } catch { return false; } })();
  const router = (() => { try { return !!require('../lib/report-015-publication').routerLimit(r); } catch { return 'throws'; } })();
  const e = COST077.expected(r, { sealed, router });
  return e.shown ? COST077.sentence(e.text) : null;
}
// A-267-5: a row's verb is "Measured" only on a TESTED receipt; a page's is "Measured" when any of its
// receipts is, else "Reported".
const verbOf = (r) => (evidenceOf(r) === 'measured' ? 'Measured' : 'Reported');
const pageVerb = (ws, entries) => (entries.some((e) => evidenceOf(readJson(ws.file(e.file))) === 'measured') ? 'Measured' : 'Reported');
const labelOf = (r) => (marked(r) ? TX.NVLABEL : plainOf(r).label);
// § Row order: source order, then the run's instant newest first, then the file path.
function rowOrder(ws, entries) {
  const so = ws.manifest.sources.map((s) => s.id);
  const t = (e) => Date.parse(readJson(ws.file(e.file)).run.date_utc);
  return entries.slice().sort((a, b) => so.indexOf(a.source) - so.indexOf(b.source) || t(b) - t(a) || cmp16(a.file, b.file)).map((e) => e.file);
}
const ordered = (set, values) => set.filter((v) => values.includes(v)).join(' ');
const sourceNames = (ws, ids) => { const n = ws.manifest.sources.filter((s) => ids.includes(s.id)).map((s) => s.name); return n.length === 1 ? n[0] : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`; };
function attributionTexts(ws, ids) {
  return ws.manifest.sources.filter((s) => ids.includes(s.id)).map((s) => (s.id === 'driftproof' ? TX.S1 : s.id === 'skill-placebo' ? TX.S2(s.commit) : TX.A1(s.commit)));
}
// § The page texts, in order, for a page path.
function pageTexts(ws, p, buildDate = BUILD_DATE) {
  if (p === 'index.html') return [TX.G4, TX.P3, TX.G6_READ, TX.G5, ...attributionTexts(ws, ws.manifest.sources.map((s) => s.id)), TX.D1, TX.B1(buildDate)];
  const entries = ws.manifest.receipts.filter((e) => pagePath(e.identity) === p);
  const id = entries[0].identity;
  const ids = [...new Set(entries.map((e) => e.source))];
  const verb = pageVerb(ws, entries);
  return [verb === 'Measured' ? 'Worth installing?' : sourceNames(ws, ids)+"'s reported results", pageName(id), TX.P1(verb, pageName(id), id, sourceNames(ws, ids)), TX.G2(verb, id), TX.G3, verb+' results', ...attributionTexts(ws, ids), TX.D1, TX.B1(buildDate)];
}
function mainRest(html) {
  let rest = mainOf(html) || '';
  for (const row of rowsOf(html)) rest = rest.replace(row.html, ' ');
  for (const en of entriesOf(html)) rest = rest.replace(en.html, ' ');
  return textOf(rest);
}

// Every number in a text, after the literal strings a rule allows are taken out.
const NUM = /\d[\d,.]*\d|\d/g;
const numbersOf = (text, literals = []) => {
  let t = ` ${text} `;
  for (const l of [...new Set(literals)].filter(Boolean).sort((a, b) => b.length - a.length)) t = t.split(l).join(' ');
  return t.match(NUM) || [];
};
function strayNumbers(text, literals, allowed) {
  return numbersOf(text, literals).filter((n) => !allowed.has(n));
}
// The literals each field's rule names, taken out whole before its numbers are read (AC-5).
function fieldLiterals(entry, r, field) {
  if (field === 'Model' || field === 'Freshness') return [r.run.model_id];
  if (field === 'Date') return [r.run.date_utc.slice(0, 10)];
  if (field === 'Skill commit') return [entry.skill_commit];
  if (field === 'Receipt') return [path.basename(entry.file)];
  return [];
}
function fieldAllowance(entry, r, ctx) {
  const exp = expectedRow(entry, r, ctx);
  return Object.fromEntries(Object.entries(exp).map(([k, v]) => { const lits = fieldLiterals(entry, r, k); return [k, { lits, nums: new Set(numbersOf(v, lits)) }]; }));
}

// ── shared state for the tests ────────────────────────────────────────────────────────────────
let BASE = null;
async function base() {
  if (!BASE) {
    const ws = workspace();
    BASE = { ws, out: await build(ws), verdicts: readJson(ws.file('index-receipts/skill-placebo/claude-code.json')) };
  }
  return BASE;
}
const ctxOf = (ws, verdicts) => ({ aliases: ws.manifest.model_aliases, verdicts });

// ══ fixture check: the readers' inputs are live ══════════════════════════════════════════════
test('fixtures: the Driftproof receipts verify and tie to Report 009\'s record, the nine skill-placebo arms import, and the hand-made NVIDIA receipts verify', () => {
  assert.ok(DP_ALL.length > 0);
  for (const d of DP_ALL) {
    const r = readJson(path.join(ROOT, d.file));
    assert.ok(verifyReceiptHash(r), d.file);
    assert.ok(fs.existsSync(path.join(ROOT, 'docs', 'r', r.receipt_hash, 'index.html')), `receipt page for ${d.file}`);
    assert.ok(DP_NAMES.includes(r.skill.name), `${d.file}: ${r.skill.name} is in Report 009's protocol`);
    assert.equal(r.run.source, undefined); assert.equal(r.run.import, undefined); assert.ok(!marked(r));
  }
  for (const n of DP_NAMES) {
    const up = DP_PATHS.get(n);
    assert.ok(up, `upstream record names ${n}`);
    assert.deepEqual([up.owner, up.repo, up.commit], [DP_OWNER, DP_REPO, DP_COMMIT], `${n}: the two records agree`);
    assert.equal(up.path.split('/').pop(), n);
    const r009 = DP_ALL.find((d) => d.report === '009' && d.name === n);
    const h = readJson(path.join(ROOT, r009.file)).skill.content_hash;
    for (const d of DP_ALL.filter((x) => x.name === n)) assert.equal(readJson(path.join(ROOT, d.file)).skill.content_hash, h, `${d.file}: Report 009's skill bytes`);
  }
  assert.deepEqual(DP.map((d) => plainOf(readJson(path.join(ROOT, d.file))).state), ['PASSED', 'UNDERPOWERED', 'NO_EFFECT']);
  for (const d of DP) assert.ok(DP_ALL.some((x) => x.file === d.file), d.file);
  assert.deepEqual(SP_ARMS.map((a) => a.key).sort(), Object.keys(SP_IDS).sort());
  for (const a of SP_ARMS) {
    const { receipt } = importHarbor({ withJob: path.join(TRIALS, a.arm), withoutJob: path.join(TRIALS, 'baseline'), skill: a.name, importedAt: AT });
    assert.equal(receipt.verification_level, 'DECLARED');
    assert.equal(receipt.run.source, 'imported/harbor');
    assert.equal(plainOf(receipt).label, LABELS.REPORTED);
    assert.equal(opposedToPublished(receipt, VERDICTS.comparisons[a.key].verdict).opposite, false, `${a.key} is not held in the base build`);
  }
  for (const n of NV) {
    const r = n.receipt();
    assert.ok(verifyReceiptHash(r));
    assert.deepEqual(validateReceipt(r).errors, [], `${n.file}: validates against v0.13`);
    assert.ok(nvidiaHead(r.source_figures), n.file);
  }
  for (const a of SP_ARMS) assert.match(a.sha, /^[0-9a-f]{40}$/);
  assert.match(SP_COMMIT, /^[0-9a-f]{40}$/);
});

// A-267-20: historical fixtures retain the schema that defines their shape.
test('AC-1 A-267-20: NVIDIA fixtures use the frozen v0.13 schema; version and missing-field plants', () => {
  const Ajv = require('ajv/dist/2020');
  const frozen = new Ajv({ allErrors: true, strict: false }).compile(NV_SCHEMA);
  for (const n of NV) {
    const r = n.receipt();
    assert.equal(r.schema_version, NV_SCHEMA_VERSION, n.file + ': frozen fixture version');
    assert.equal(Object.hasOwn(r.skill, 'unit'), false);
    assert.equal(Object.hasOwn(r.run, 'delivery'), false);
    assert.equal(frozen(r), true, JSON.stringify(frozen.errors));
    assert.equal(validateReceipt(r).valid, true, n.file + ': version dispatch');
    assert.ok(verifyReceiptHash(r));
    const missing = structuredClone(r);
    delete missing.run.answered_by;
    sealReceipt(missing);
    const old = validateReceipt(missing);
    assert.equal(old.valid, false, 'v0.13 still requires answered_by');
    assert.ok(old.errors.some(e => e.instancePath === '/run' && e.params?.missingProperty === 'answered_by'));
    const restamped = structuredClone(r);
    restamped.schema_version = RECEIPT_SCHEMA_VERSION;
    sealReceipt(restamped);
    assert.ok(verifyReceiptHash(restamped));
    const current = validateReceipt(restamped);
    assert.equal(current.valid, false, 'a current-version label cannot admit a legacy shape');
    for (const [at, field] of [['/skill', 'unit'], ['/run', 'delivery']])
      assert.ok(current.errors.some(e => e.instancePath === at && e.params?.missingProperty === field), field + ' remains required');
  }
});

// ══ AC-1 ═════════════════════════════════════════════════════════════════════════════════════
test('AC-1: rows read every listed receipt and only those; the manifest is complete; each file is pinned, in its folder and of its source\'s level', async () => {
  const sp0 = `index-receipts/skill-placebo/${SP_ARMS[0].arm}.json`;
  await refusesBoth(workspace({ after: (ws) => fs.appendFileSync(ws.file(DP[0].file), ' ') }), /sha256/);
  await refusesBoth(workspace({ before: (ws) => { const r = readJson(ws.file(sp0)); r.comparison.delta = 0.9; write(ws.file(sp0), JSON.stringify(r, null, 2)); } }), /hash/);
  await refusesBoth(workspace({ before: (ws) => { const rel = 'receipts/report-007/x.json'; copy(path.join(ROOT, DP[0].file), ws.file(rel)); entryOf(ws, DP[0].file).file = rel; } }), /report-007/);
  await refusesBoth(workspace({ before: (ws) => { entryOf(ws, DP[0].file).report = '011'; } }), /report/);
  // Completeness: a dropped run, a verdicts key with no entry, an unlisted imported file.
  const run2 = DP_ALL.find((d) => d.file.startsWith('receipts/report-013/run-2/'));
  await refusesBoth(workspace({ before: (ws) => { ws.manifest.receipts = ws.manifest.receipts.filter((e) => e.file !== run2.file); } }), new RegExp(escapeRegExp(path.basename(run2.file))));
  await refusesBoth(workspace({ before: (ws) => { ws.manifest.receipts = ws.manifest.receipts.filter((e) => e.verdict_key !== SP_ARMS[1].key); fs.rmSync(ws.file(`index-receipts/skill-placebo/${SP_ARMS[1].arm}.json`)); } }), new RegExp(SP_ARMS[1].key));
  await refusesBoth(workspace({ before: (ws) => write(ws.file('index-receipts/nvidia/unlisted.json'), JSON.stringify(NV[0].receipt(), null, 2)) }), /unlisted\.json/);
  await refusesBoth(workspace({ before: (ws) => { ws.manifest.receipts.push({ ...entryOf(ws, DP[0].file) }); } }), /twice|listed/);
  // The source rules, each after the sha256 and the hash hold.
  await refusesBoth(workspace({ before: (ws) => reseal(ws, sp0, (r) => { r.verification_level = 'TESTED'; }) }), /verification_level/);
  await refusesBoth(workspace({ before: (ws) => reseal(ws, NV[0].file, (r) => { delete r.uncertainty_unavailable; delete r.source_figures; }) }), /mark|marked/);
  await refusesBoth(workspace({ before: (ws) => fs.rmSync(ws.file(`docs/r/${readJson(ws.file(DP[0].file)).receipt_hash}/index.html`)) }), /docs\/r/);
  await refusesBoth(workspace({ before: (ws) => { const rel = 'index-receipts/skill-placebo/copied.json'; copy(path.join(ROOT, DP[0].file), ws.file(rel)); ws.manifest.receipts.push({ source: 'skill-placebo', file: rel, verdict_key: SP_ARMS[0].key, identity: SP_ARMS[0].identity, name: SP_ARMS[0].name, skill_commit: SP_ARMS[0].sha }); } }), /run\.source|imported\/harbor|DECLARED/);
  // No row names Report 010, and the reader sees one planted.
  const { out } = await base();
  for (const [p, html] of out.pages) assert.doesNotMatch(textOf(html), /Report 010/, p);
  const h0 = out.pages.get(pagePath(entryOf((await base()).ws, DP[0].file).identity));
  assert.match(textOf(h0), /Report 009/);
  assert.match(textOf(h0.replace('Report 009', 'Report 010')), /Report 010/);
});

// ══ AC-2 ═════════════════════════════════════════════════════════════════════════════════════


// ══ AC-3 ═════════════════════════════════════════════════════════════════════════════════════
test('AC-3: one page per identity, the identity read from the source\'s own record; mismatches, collisions and reserved names are refused', async () => {
  const { ws, out } = await base();
  const want = [...new Set(ws.manifest.receipts.map((e) => pagePath(e.identity)))].sort(cmp16);
  const got = [...out.pages.keys()].filter((p) => p !== 'index.html').sort(cmp16);
  assert.deepEqual(got, want);
  const dpPage = out.pages.get(pagePath(entryOf(ws, DP[0].file).identity));
  for (const row of rowsOf(dpPage)) assert.equal(row.fields['Skill commit'].text, DP_COMMIT, row.receipt);
  // The identity is the record's.
  await refusesBoth(workspace({ before: (w) => { const e = entryOf(w, DP[0].file); e.identity = { ...e.identity, owner: 'other-owner' }; } }), /owner|identity/);
  await refusesBoth(workspace({ before: (w) => { entryOf(w, DP[0].file).skill_commit = '0'.repeat(40); } }), /skill_commit|commit/);
  // Sealed again, the receipt has a new hash, so a stand-in page is written for it: AC-1's source rule
  // holds, and the check reached is AC-3's.
  await refusesBoth(workspace({ before: (w) => { reseal(w, DP[2].file, (r) => { r.skill.content_hash = '0'.repeat(64); }); write(w.file(`docs/r/${readJson(w.file(DP[2].file)).receipt_hash}/index.html`), '<!doctype html><title>receipt page stand-in</title>\n'); } }), /content_hash/);
  await refusesBoth(workspace({ before: (w) => { const e = w.manifest.receipts.find((x) => x.verdict_key === SP_ARMS[0].key); e.identity = { ...e.identity, owner: 'not-the-record' }; } }), /owner|identity/);
  // A-267-3: the skill commit is the lock's sha, and an arm the lock does not name is refused.
  await refusesBoth(workspace({ before: (w) => { w.manifest.receipts.find((x) => x.verdict_key === SP_ARMS[0].key).skill_commit = '0'.repeat(40); } }), /skill_commit|commit/);
  await refusesBoth(workspace({ before: (w) => { const lock = readJson(w.file(SP_RECORD)); lock.skills = lock.skills.filter((s) => s.id !== SP_ARMS[3].key); write(w.file(SP_RECORD), JSON.stringify(lock, null, 2)); } }), new RegExp(SP_ARMS[3].key));
  const spPage = out.pages.get(pagePath(SP_ARMS[0].identity));
  assert.equal(rowsOf(spPage)[0].fields['Skill commit'].text, SP_ARMS[0].sha, 'a skill-placebo row shows its lock commit');
  await refusesBoth(workspace({ before: (w) => { const e = entryOf(w, NV[1].file); e.identity = { ...e.identity, path: 'skills/elsewhere' }; e.name = 'elsewhere'; } }), /path|identity/);
  // Two arms recorded under one repository name and one path, under two owners: two pages.
  const two = workspace({ arms: (list) => { for (const [a, owner] of [[list[0], 'owner-x'], [list[2], 'owner-y']]) { a.identity = { owner, repo: 'shared', path: '', unit: 'skill' }; a.name = 'shared'; } } });
  const b = await build(two);
  assert.ok(b.pages.has('owner-x/shared/shared/index.html'));
  assert.ok(b.pages.has('owner-y/shared/shared/index.html'));
  // Two paths in one repository ending in one segment; owners equal when lowercased; reserved names.
  await refusesBoth(workspace({ before: (w) => { const e = entryOf(w, NV[0].file); e.identity = { ...e.identity, path: 'other/newer-card' }; } }), /newer-card/);
  await refusesBoth(workspace({ arms: (list) => { list[0].identity = { owner: 'Case-Owner', repo: 'same', path: '', unit: 'skill' }; list[0].name = 'same'; list[2].identity = { owner: 'case-owner', repo: 'same', path: '', unit: 'skill' }; list[2].name = 'same'; } }), /case-owner/i);
  await refusesBoth(workspace({ arms: (list) => { list[0].identity = { ...list[0].identity, owner: 'receipts' }; } }), /receipts/);
  await refusesBoth(workspace({ arms: (list) => { list[0].identity = { ...list[0].identity, repo: 'index.html' }; list[0].name = 'index.html'; } }), /index\.html/);
  // A name that is not the path's last segment; a segment that is not a plain name.
  await refusesBoth(workspace({ before: (w) => { entryOf(w, DP[0].file).name = 'not-the-name'; } }), /name/);
  // A-267-2: an NVIDIA identity is its card folder. A card whose printed name differs is built under
  // the folder and its printed name is on no page; a manifest name other than the folder is refused.
  const printed = readJson(ws.file(NV[1].file)).skill.name;
  assert.notEqual(printed, NV[1].name);
  assert.ok(out.pages.has(pagePath(NV[1].identity)));
  for (const [p, html] of out.pages) assert.ok(!html.includes(printed), `${p}: the card's printed name ${printed}`);
  await refusesBoth(workspace({ before: (w) => { entryOf(w, NV[1].file).name = 'other-name'; } }), /name/);
  await refusesBoth(workspace({ arms: (list) => { list[0].identity = { ...list[0].identity, owner: '../x' }; } }), /plain|segment|\.\.\/x/);
  // Plant: a row showing a commit the record does not hold is seen.
  const row = rowsOf(dpPage)[0];
  assert.notEqual(row.fields['Skill commit'].text.replace(DP_COMMIT, '1'.repeat(40)), DP_COMMIT);
});

// ══ AC-4, AC-6, AC-7, AC-8, AC-19, AC-20: every row says exactly what its receipt allows ════════
test('AC-4, AC-6, AC-7, AC-8, AC-19, AC-20: each page holds one row per receipt in order, and each row\'s fields are the fixed texts filled from that receipt', async () => {
  const { ws, out, verdicts } = await base();
  const ctx = ctxOf(ws, verdicts);
  const byPage = new Map();
  for (const e of ws.manifest.receipts) { const p = pagePath(e.identity); byPage.set(p, [...(byPage.get(p) || []), e]); }
  for (const [p, entries] of byPage) {
    const html = out.pages.get(p);
    assert.ok(html, p);
    const rows = rowsOf(html);
    assert.deepEqual(rows.map((r) => r.receipt), rowOrder(ws, entries), `${p}: one row per receipt, in § Row order`);
    for (const row of rows) {
      const e = entryOf(ws, row.receipt);
      const r = readJson(ws.file(e.file));
      const exp = expectedRow(e, r, ctx);
      for (const [k, v] of Object.entries(exp)) assert.equal(row.fields[k] && row.fields[k].text, v, `${p} ${e.file} ${k}`);
      assert.deepEqual(row.order, (e.source === 'skill-placebo' ? FIELDS_SP : FIELDS_DP)(verbOf(r)), `${p} ${e.file}: the fields, in order, and no other`);
      assert.equal(row.source, e.source);
      assert.equal(row.evidence, evidenceOf(r));
      assert.equal(row.freshness, freshnessOf(r, ctx.aliases).value);
    }
  }
  // Plant: two rows swapped is seen by the order comparison.
  const p0 = pagePath(entryOf(ws, DP[0].file).identity);
  const rs = rowsOf(out.pages.get(p0));
  const swapped = out.pages.get(p0).replace(rs[0].html, '\u0000').replace(rs[1].html, rs[0].html).replace('\u0000', rs[1].html);
  assert.notDeepEqual(rowsOf(swapped).map((r) => r.receipt), rowOrder(ws, byPage.get(p0)));
});

test('AC-6, AC-7: no verdict word on a row that has none, NVIDIA headlines by the ladder, and the plants the reader must see', async () => {
  const { ws, out, verdicts } = await base();
  const ctx = ctxOf(ws, verdicts);
  for (const [p, html] of out.pages) {
    for (const row of rowsOf(html)) {
      const r = readJson(ws.file(row.receipt));
      const words = row.fields.Result ? row.fields.Result.text : '';
      if (r.verification_level !== 'TESTED') for (const w of VERDICT_WORDS) assert.ok(!new RegExp(`\\b${w}\\b`).test(words), `${p} ${row.receipt}: ${w}`);
      if (marked(r)) {
        const cells = r.source_figures.rows.map((x) => x.printed);
        const own = cells.reduce((t, c) => t.split(c).join(' '), words.replace(TX.R7, ''));
        assert.doesNotMatch(own, /±/, `${p}: no ± the card does not print`);
        if (r.source_figures.rows.some((x) => x.uplift_unit === 'unstated')) assert.doesNotMatch(own, /\bpoints?\b/, `${p}: no points for an unstated unit`);
      }
    }
  }
  const nvRow = (n) => rowsOf(out.pages.get(pagePath(n.identity))).find((x) => x.receipt === n.file);
  // The issue's example, read back from a receipt whose Overall uplift is 38.4 with 1 attempt.
  const nv = nvRow(NV[0]);
  assert.ok(nv.fields.Result.text.startsWith('NVIDIA reported +38.4 points overall (1 attempt per task).'));
  assert.ok(nv.fields.Result.text.includes(`Overall: ${NV[0].receipt().source_figures.rows[0].printed}`), 'the Overall cell is kept');
  // An Overall row whose unit is unstated reads R-8, never R-6, and keeps its cell.
  const ov = nvRow(NV[2]);
  assert.ok(ov.fields.Result.text.startsWith(TX.R8('70% (+20%)', TX.attempts(null))), ov.fields.Result.text);
  assert.ok(ov.fields.Result.text.includes('Overall: 70% (+20%)'));
  // An Overall row that fits no rung refuses the build.
  await refusesBoth(workspace({ before: (w) => reseal(w, NV[3].file, (r) => { r.source_figures.rows[0].score_pct = null; }) }), new RegExp(escapeRegExp(path.basename(NV[3].file))));
  // Plants: each doctored row fails the same comparison.
  const spRow = rowsOf(out.pages.get(pagePath(SP_ARMS[0].identity)))[0];
  const spExp = expectedRow(entryOf(ws, spRow.receipt), readJson(ws.file(spRow.receipt)), ctx);
  assert.notEqual(spRow.fields.Result.text.replace(LABELS.REPORTED, LABELS.PASSED), spExp.Result);
  assert.notEqual(spRow.fields.Result.text.replace(LABELS.REPORTED, 'Helps'), spExp.Result);
  const upRow = rowsOf(out.pages.get(pagePath(entryOf(ws, DP[1].file).identity))).find((x) => x.receipt === DP[1].file);
  const upExp = expectedRow(entryOf(ws, DP[1].file), readJson(ws.file(DP[1].file)), ctx);
  assert.match(upExp.Result, /Not enough draws to conclude at this effect floor|More cases, not more draws, are needed to conclude at this effect floor/);
  assert.notEqual(upRow.fields.Result.text.replace(/ at this effect floor/, ''), upExp.Result);
  const nvExp = expectedRow(entryOf(ws, NV[0].file), readJson(ws.file(NV[0].file)), ctx);
  assert.notEqual(nv.fields.Result.text.replace(' (1 attempt per task)', ''), nvExp.Result);
  assert.notEqual(nv.fields.Result.text.replace('NVIDIA reported', 'Clearly helped. NVIDIA reported'), nvExp.Result);
  assert.notEqual(nv.fields.Result.text.replace('Correctness: ', 'Correctness: baseline 51%, '), nvExp.Result);
  const unstated = nvRow(NV[1]);
  assert.notEqual(unstated.fields.Result.text.replace('84% (+33%)', '84% (+33 points)'), expectedRow(entryOf(ws, NV[1].file), readJson(ws.file(NV[1].file)), ctx).Result);
});

// ══ AC-5, AC-5a ══════════════════════════════════════════════════════════════════════════════
test('AC-5, AC-5a: every number traces field by field and page by page; a row is its fields; a page is its fixed texts and the chrome', async () => {
  const { ws, out, verdicts } = await base();
  const ctx = ctxOf(ws, verdicts);
  const allow = new Map(ws.manifest.receipts.map((e) => [e.file, fieldAllowance(e, readJson(ws.file(e.file)), ctx)]));
  const org = [];
  const walk = (v) => { if (typeof v === 'string') org.push(v); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
  walk(organization());
  const check = (html, p) => {
    const stray = [];
    const entries = ws.manifest.receipts.filter((e) => pagePath(e.identity) === p);
    const idLits = (p === 'index.html' ? ws.manifest.receipts : entries).flatMap((e) => [`${e.identity.owner}/${e.identity.repo}/${pageName(e.identity)}`, e.identity.owner, e.identity.repo, e.identity.path, e.name]);
    for (const row of rowsOf(html)) {
      const a = allow.get(row.receipt);
      if (!a) { stray.push(`${p}: a row for an unlisted receipt ${row.receipt}`); continue; }
      for (const [k, f] of Object.entries(row.fields)) {
        const fa = a[k] || { lits: [], nums: new Set() };
        stray.push(...strayNumbers(f.text, fa.lits, fa.nums).map((n) => `${row.receipt} ${k}: ${n}`));
      }
      stray.push(...strayNumbers(rowLoose(row), [], new Set()).map((n) => `${row.receipt} outside its fields: ${n}`));
      for (const at of attrsOf(row.tag)) if (!['href', 'src', 'data-receipt'].includes(at.name)) stray.push(...strayNumbers(at.value, [], new Set()).map((n) => `${row.receipt} @${at.name}: ${n}`));
    }
    for (const en of entriesOf(html)) {
      const files = ws.manifest.receipts.filter((e) => `${pagePath(e.identity).replace(/index\.html$/, '')}` === en.page);
      const lits = [...idLits, ...files.map((e) => readJson(ws.file(e.file)).run.model_id)];
      const nums = new Set(files.flatMap((e) => [...allow.get(e.file).Model.nums,...allow.get(e.file).Result.nums]));
      stray.push(...strayNumbers(en.text, lits, nums).map((n) => `entry ${en.page}: ${n}`));
    }
    const known = p === 'index.html' || entries.length > 0;
    const pageNums = new Set(known ? pageTexts(ws, p).flatMap((t) => numbersOf(t, idLits)) : []);
    stray.push(...strayNumbers(mainRest(html), idLits, pageNums).map((n) => `${p} outside rows: ${n}`));
    const url = `https://driftproofhq.com/skills/${p.replace(/index\.html$/, '')}`;
    const headLits = [...idLits, url, titleOf(html), descOf(html), BUILD_DATE, ...org];
    stray.push(...strayNumbers(`${titleOf(html) || ''} ${descOf(html) || ''}`, idLits, new Set()).map((n) => `${p} title or description: ${n}`));
    for (const s of ldStrings(html)) stray.push(...strayNumbers(s, headLits, new Set()).map((n) => `${p} JSON-LD: ${n}`));
    return stray;
  };
  const pages = [...out.files.keys()].filter((p) => p.endsWith('.html'));
  assert.ok(pages.includes('index.html'));
  for (const p of pages) assert.deepEqual(check(out.pages.get(p), p), [], p);
  // AC-5a: rows hold only their fields; <main> is the page texts; outside <main> is the chrome.
  for (const p of pages) {
    const html = out.pages.get(p);
    for (const row of rowsOf(html)) { assert.equal(rowLoose(row), '', `${p} ${row.receipt}: text outside the fields`); assert.match(row.inner, /^\s*<dl>[\s\S]*<\/dl>\s*<details class="receipt-metadata"><summary>Receipt metadata<\/summary><dl>[\s\S]*<\/dl><\/details>\s*$/, `${p} ${row.receipt}: result fields then metadata`); }
    const es = ws.manifest.receipts.filter(e=>pagePath(e.identity)===p);
    const heads=p==='index.html'?[]:[pageVerb(ws,es)+' results',...rowOrder(ws,es).map(f=>{const e=entryOf(ws,f),r=readJson(ws.file(f));return expectedRow(e,r,{aliases:ws.manifest.model_aliases,verdicts}).Result && expectedRow(e,r,{aliases:ws.manifest.model_aliases,verdicts})[byField(verbOf(r))];})];
    const ch = chromeOf(p,heads);
    const rest = ch.inside ? mainRest(html).split(ch.inside).join(' ') : mainRest(html);
    assert.equal(rest.replace(/\s+/g, ' ').trim(), pageTexts(ws, p).join(' '), `${p}: the page texts`);
    assert.equal(outsideMain(html), ch.outside, `${p}: the chrome`);
  }
  // Plants, read by the same checks.
  const p = pagePath(entryOf(ws, DP[0].file).identity);
  const html = out.pages.get(p);
  const r0 = readJson(ws.file(DP[0].file));
  const row0 = rowsOf(html).find((x) => x.receipt === DP[0].file);
  const s = n3(r0.comparison.with_skill_score); const s1 = (Number(s) + 0.001).toFixed(3);
  assert.ok(!allow.get(DP[0].file).Result.nums.has(s1));
  assert.notDeepEqual(check(html.replace(row0.fields.Result.html, row0.fields.Result.html.replace(s, s1)), p), []);
  assert.equal(r0.run.date_utc.slice(0, 10), '2026-09-15');
  assert.ok(!allow.get(DP[0].file).Result.nums.has('15') && !allow.get(DP[0].file).Result.nums.has('9'), 'the date\'s parts are not Result numbers');
  assert.notDeepEqual(check(html.replace(row0.fields.Result.html, `${row0.fields.Result.html} helped on 9 of 15 tasks`), p), []);
  assert.notDeepEqual(check(html.replace(row0.inner, `${row0.inner}<p>1234 tokens</p>`), p), []);
  assert.notDeepEqual(check(html.replace('</main>', '<p>Mean of the rows: 0.777; 4321 tokens</p></main>'), p), []);
  const rows = rowsOf(html);
  const tokA = rows[0].fields.Tokens; const numB = numbersOf(rows[1].fields.Tokens.text).find((n) => !allow.get(rows[0].receipt).Tokens.nums.has(n));
  assert.ok(numB, 'a token figure of the second row that the first row does not allow');
  assert.notDeepEqual(check(html.replace(tokA.html, `${tokA.html} ${numB}`), p), []);
  if (ldStrings(html).length) assert.notDeepEqual(check(html.replace(/("name"\s*:\s*")/, '$1777 '), p), []);
  assert.notDeepEqual(check('<!doctype html><html><head><title>x</title></head><body><main><p>Rows: 42</p></main></body></html>', 'zzz/new/index.html'), []);
  assert.notEqual(mainRest(html.replace(/(<main\b[^>]*>)/, '$1<p>This skill helps</p>')), mainRest(html));
  assert.notEqual(rowLoose({ inner: row0.inner.replace('</dl>', '</dl><p>A note</p>') }), '');
  assert.notEqual(outsideMain(html.replace('</footer>', '<p>Trusted by many.</p></footer>')), chromeOf(p).outside);
});

// ══ AC-8 ═════════════════════════════════════════════════════════════════════════════════════
test('AC-8: freshness follows the registry the stale check reads; a missing date, an unknown model, a newer model and a bad alias read as the spec says', async () => {
  const { out } = await base();
  for (const [p, html] of out.pages) assert.doesNotMatch(textOf(html), FRESH_WORDS, p);
  const reg = readJson(path.join(ROOT, 'config', 'models.json'));
  // A registry with claude-opus-4-8's release date removed: the aliased NVIDIA row reads F-3.
  const noDate = JSON.parse(JSON.stringify(reg));
  noDate.models.find((m) => m.id === 'claude-opus-4-8').released = null;
  const regFile = path.join(tmp('reg'), 'models.json');
  write(regFile, JSON.stringify(noDate));
  const ws = workspace();
  const outDir = path.join(ws.root, 'docs', 'skills');
  const r = cli(['--root', ws.root, '--out', outDir, '--build-date', BUILD_DATE], { DRIFTPROOF_REGISTRY: regFile });
  assert.equal(r.status, 0, r.stderr);
  const row = rowsOf(fs.readFileSync(path.join(outDir, pagePath(NV[0].identity)), 'utf8')).find((x) => x.receipt === NV[0].file);
  assert.equal(row.fields.Freshness.text, TX.F3('Reported', 'Opus 4.8'));
  // An unknown model reads F-5.
  const older = rowsOf(fs.readFileSync(path.join(outDir, pagePath(NV[1].identity)), 'utf8'))[0];
  assert.equal(older.fields.Freshness.text, TX.F5);
  assert.equal(older.fields.Model.text, 'model not stated');
  // A registry with a newer opus model added: the Opus 5.5 rows of Report 011 name it in F-1.
  const newer = JSON.parse(JSON.stringify(reg));
  newer.models.unshift({ ...reg.models.find((m) => m.id === 'claude-opus-5-5'), id: 'claude-opus-9-9', released: '2026-10-01' });
  const newerFile = path.join(tmp('reg'), 'models.json');
  write(newerFile, JSON.stringify(newer));
  const ws2 = workspace();
  const out2 = path.join(ws2.root, 'docs', 'skills');
  assert.equal(cli(['--root', ws2.root, '--out', out2, '--build-date', BUILD_DATE], { DRIFTPROOF_REGISTRY: newerFile }).status, 0);
  const r11 = rowsOf(fs.readFileSync(path.join(out2, pagePath(entryOf(ws2, DP[1].file).identity)), 'utf8')).find((x) => x.receipt === DP[1].file);
  assert.equal(r11.fields.Freshness.text, TX.F1('Measured', 'Opus 5.5', 'opus', 'Opus 9.9'));
  assert.equal(r11.freshness, 'newer');
  // An alias outside the rule is refused.
  await refusesBoth(workspace({ before: (w) => { w.manifest.model_aliases['openai/x/gpt-5.5'] = 'claude-opus-5'; } }), /alias/);
  // The word "current" planted in a freshness line is seen.
  assert.match(row.html.replace('Freshness unknown', 'current'), FRESH_WORDS);
});

// ══ AC-9 ═════════════════════════════════════════════════════════════════════════════════════
test('AC-9: an opposite reading holds the whole identity; nothing under docs/skills names it by path, bare name or file', async () => {
  const arm = SP_ARMS.find((a) => a.key === 'planning-with-files');
  const rel = `index-receipts/skill-placebo/${arm.arm}.json`;
  const ws = workspace({
    before: (w) => {
      reseal(w, rel, (r) => { r.comparison.delta = 0.5; r.comparison.delta_uncertainty = 0.1; });
      const v = readJson(w.file('index-receipts/skill-placebo/claude-code.json'));
      v.comparisons[arm.key].verdict = 'worse than placebo';
      write(w.file('index-receipts/skill-placebo/claude-code.json'), JSON.stringify(v, null, 2));
    },
  });
  const planted = readJson(ws.file(rel));
  assert.equal(opposedToPublished(planted, 'worse than placebo').opposite, true);
  const b = await build(ws);
  const id = arm.identity;
  const name = `${id.owner}/${id.repo}/${pageName(id)}`;
  assert.deepEqual(b.held.map((h) => [h.identity, h.source, h.receipt]), [[name, 'skill-placebo', rel]]);
  for (const [p, bytes] of b.files) {
    const t = bytes.toString('utf8');
    assert.ok(!p.startsWith(`${id.owner}/${id.repo}/`), `held page written: ${p}`);
    assert.ok(!t.includes(name), `held identity named in ${p}`);
    assert.ok(!t.includes(pageName(id)), `held bare name named in ${p}`);
    assert.ok(!t.includes(path.basename(rel)), `held receipt named in ${p}`);
  }
  const out = path.join(ws.root, 'docs', 'skills');
  const r = cli(['--root', ws.root, '--out', out, '--build-date', BUILD_DATE]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes(`held: ${name} (skill-placebo): the recomputed direction is up and the source's verdict is "worse than placebo"`), r.stdout);
  // Not held: the same receipt beside "no better than placebo".
  assert.equal(opposedToPublished(planted, 'no better than placebo').opposite, false);
  // Quoted exactly, in its own field, on a row that is not held; one character off is seen.
  const { out: o, verdicts } = await base();
  const row = rowsOf(o.pages.get(pagePath(SP_ARMS[0].identity)))[0];
  const quote = TX.R3(verdicts.comparisons[SP_ARMS[0].key].verdict);
  assert.equal(row.fields['Source\'s verdict'].text, quote);
  assert.notEqual(row.fields['Source\'s verdict'].text.replace('placebo"', 'placebo."'), quote);
});

// ══ AC-10, AC-11 ═════════════════════════════════════════════════════════════════════════════
test('AC-10, AC-11: every page carries its sources\' attribution and licence, and one prefilled dispute link', async () => {
  const { ws, out } = await base();
  const DEED = 'https://creativecommons.org/licenses/by/4.0/';
  for (const [p, html] of out.pages) {
    const sources = p === 'index.html' ? ws.manifest.sources.map((s) => s.id) : [...new Set(rowsOf(html).map((r) => r.source))];
    const hrefs = attrsOf(html).filter((a) => a.name === 'href').map((a) => a.value);
    const text = textOf(html);
    for (const id of sources) {
      const s = ws.manifest.sources.find((x) => x.id === id);
      assert.ok(text.includes(s.name), `${p}: ${s.name}`);
      if (s.commit) assert.ok(hrefs.includes(`https://github.com/${s.repo}/tree/${s.commit}`), `${p}: ${s.repo} at its commit`);
      if (id === 'nvidia') { assert.ok(hrefs.includes(DEED), `${p}: CC BY 4.0 deed`); assert.ok(text.includes(TX.A1(s.commit)), `${p}: A-1`); }
      if (id === 'skill-placebo') { assert.ok(hrefs.includes('/skills/receipts/skill-placebo/LICENSE'), `${p}: MIT text`); assert.ok(text.includes(TX.S2(s.commit)), `${p}: S-2`); }
      if (id === 'driftproof') assert.ok(text.includes(TX.S1), `${p}: S-1`);
    }
    const disputes = [...html.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].filter((m) => textOf(m[2]) === TX.D1);
    assert.equal(disputes.length, 1, `${p}: one dispute link`);
    const u = new URL(decode(disputes[0][1]));
    assert.equal(`${u.origin}${u.pathname}`, 'https://github.com/driftproofhq/driftproof/issues/new');
    assert.equal(u.searchParams.get('labels'), 'index');
    const name = p === 'index.html' ? null : p.replace(/\/index\.html$/, '');
    assert.equal(u.searchParams.get('title'), name ? `Skill index: ${name}` : 'Skill index');
    const body = u.searchParams.get('body');
    assert.ok(body.includes(`https://driftproofhq.com/skills/${p.replace(/index\.html$/, '')}`), `${p}: body names the page`);
    for (const row of rowsOf(html)) {
      const r = readJson(ws.file(row.receipt));
      assert.ok(body.includes(path.basename(row.receipt)) && body.includes(r.receipt_hash), `${p}: body names ${row.receipt}`);
      const e = entryOf(ws, row.receipt);
      if (e.source === 'driftproof') assert.ok(attrsOf(row.fields['Measured by'].html).some((a) => a.name === 'href' && a.value === `/reports/${e.report}/`), `${p}: report link`);
    }
  }
  for (const s of ['skill-placebo', 'nvidia']) assert.ok(fs.readFileSync(ws.file(`index-receipts/${s}/LICENSE`)).equals(out.files.get(`receipts/${s}/LICENSE`)), `${s} licence served`);
});

// ══ AC-12 ════════════════════════════════════════════════════════════════════════════════════
// A page without its <script> elements, every other byte as it was. Read by spec 148's tokenizer, not
// a regex (issue 335): it finds </script > and leaves no <script after one pass. The tokenizer drops a
// tag the input ends inside, which is no script element, so that tail is kept.
function withoutScript(s) {
  const src = String(s);
  let read = ''; let out = ''; let inScript = false;
  for (const t of tokenize(src)) {
    const piece = t.type === 'text' ? t.text : t.raw;
    read += piece;
    if (t.type === 'start' && t.name === 'script') { inScript = true; continue; }
    if (inScript) { if (t.type === 'end' && t.name === 'script') inScript = false; continue; }
    out += piece;
  }
  return inScript ? out : out + src.slice(read.length);
}
test('AC-12: the list page names every identity with its scripts stripped, each entry says what its page\'s rows say, and the filter is an island', async () => {
  const { ws, out } = await base();
  const html = out.pages.get('index.html');
  // The script drop reads a script element in any case and with a spaced end tag, and keeps every other byte.
  assert.equal(withoutScript('a<SCRIPT type="x">1</script >b<li class="skill-entry">c</li><script src="/s.js"></script>d<x'), 'ab<li class="skill-entry">c</li>d<x');
  const noScript = withoutScript(html);
  const pages = [...new Set(ws.manifest.receipts.map((e) => pagePath(e.identity).replace(/index\.html$/, '')))].sort(cmp16);
  const entries = entriesOf(noScript);
  assert.deepEqual(entries.map((e) => e.page), pages);
  const expectEntry = (page) => {
    const es = ws.manifest.receipts.filter((e) => pagePath(e.identity).replace(/index\.html$/, '') === page);
    const files = rowOrder(ws, es);
    const rs = files.map((f) => ({ e: entryOf(ws, f), r: readJson(ws.file(f)) }));
    const id = es[0].identity;
    const rows = rs.map(({ e, r }) => TX.L1(ws.manifest.sources.find((s) => s.id === e.source).name, modelOf(r, ws.manifest.model_aliases), labelOf(r))+' '+expectedRow(e,r,{aliases:ws.manifest.model_aliases,verdicts:readJson(ws.file(ws.manifest.sources.find(s=>s.id==='skill-placebo').verdicts.file))}).Result);
    return {
      text: [pageName(id), `${id.owner}/${id.repo}${id.unit==='plugin'?' (plugin bundle)':''}`, ...rows].join(' '),
      rows,
      path: id.path,
      source: ordered(SETS.source, rs.map(({ e }) => e.source)),
      evidence: ordered(SETS.evidence, rs.map(({ r }) => evidenceOf(r))),
      freshness: ordered(SETS.freshness, rs.map(({ r }) => freshnessOf(r, ws.manifest.model_aliases).value)),
    };
  };
  const same = (en) => { const x = expectEntry(en.page); return en.text === x.text && JSON.stringify(en.rows) === JSON.stringify(x.rows) && en.path === x.path && en.source === x.source && en.evidence === x.evidence && en.freshness === x.freshness; };
  for (const e of entries) {
    assert.ok(noScript.includes(`href="/skills/${e.page}"`), e.page);
    const x = expectEntry(e.page);
    assert.equal(e.text, x.text, `${e.page}: labels`);
    // A-267-6 (issue 315): each L-1 is one <span class="skill-entry-row">, and data-path is the identity's path.
    assert.deepEqual(e.rows, x.rows, `${e.page}: each row a <span class="skill-entry-row">`);
    assert.equal(e.path, x.path, `${e.page}: data-path`);
    assert.deepEqual([e.source, e.evidence, e.freshness], [x.source, x.evidence, x.freshness], `${e.page}: data-*`);
  }
  assert.match(html, /data-island="skill-filter"/);
  const allowed = new Set([...(applyChrome(SKELETON, 'skills/index.html').match(/<script\b[^>]*>/gi) || []), ...((beaconFor(siteConfig().cloudflare_analytics_token) || '').match(/<script\b[^>]*>/gi) || [])]);
  for (const [p, h] of out.pages) {
    for (const s of h.match(/<script\b[^>]*>/gi) || []) assert.ok(/type="application\/ld\+json"/.test(s) || /src="\/islands\/loader\.js"/.test(s) || allowed.has(s), `${p}: ${s}`);
  }
  // Plants: each is seen by the same comparisons.
  assert.notDeepEqual(entriesOf(noScript.replace(entries[0].html, '')).map((e) => e.page), pages);
  const upPage = pagePath(entryOf(ws, DP[1].file).identity).replace(/index\.html$/, '');
  const up = entries.find((e) => e.page === upPage);
  assert.ok(up.text.includes(LABELS.UNDERPOWERED) || up.text.includes(LABELS.UNDERPOWERED_CASES));
  assert.ok(!same({ ...up, text: up.text.replace(/Too few (answers|test tasks) to tell/, LABELS.PASSED) }));
  const spEntry = entries.find((e) => e.page === pagePath(SP_ARMS[0].identity).replace(/index\.html$/, ''));
  assert.ok(!same({ ...spEntry, evidence: 'measured' }));
  const nvEntry = entries.find((e) => e.page === pagePath(NV[0].identity).replace(/index\.html$/, ''));
  assert.ok(!same({ ...nvEntry, source: '' }));
  assert.ok(!same({ ...spEntry, source: 'other' }));
  // A-267-6: an entry carrying its name as its path, and one whose rows are bare text.
  const dpEntry = entries.find((e) => e.path);
  assert.ok(dpEntry && !same({ ...dpEntry, path: dpEntry.path.split('/').pop() }));
  assert.ok(!same({ ...dpEntry, rows: [] }));
  assert.ok(!allowed.has('<script>') && !/src=/.test('<script>'), 'an inline script is not allowed');
});

// ══ AC-13 ════════════════════════════════════════════════════════════════════════════════════


test('AC-13 A-267-18: every indexable skill page is listed and every noindex skill page is absent from all sitemap children', () => {
  const sm = ['sitemap-pages.xml','sitemap-receipts.xml'].map(p=>fs.readFileSync(path.join(ROOT,'docs',p),'utf8')).join('\n');
  const dir = path.join(ROOT, 'docs', 'skills');
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name === 'index.html' ? [path.join(d, e.name)] : []));
  const pages = walk(dir);
  assert.ok(pages.length > 0, 'docs/skills holds pages');
  for (const f of pages) assert.equal(sm.includes(`<loc>https://driftproofhq.com/skills/${path.relative(dir, path.dirname(f)).split(path.sep).join('/')}${path.dirname(f) === dir ? '' : '/'}</loc>`), !/<meta name="robots" content="noindex, follow">/.test(fs.readFileSync(f,'utf8')), f);
});

// ══ AC-14, AC-14a ════════════════════════════════════════════════════════════════════════════
// A-267-4 (Maverick's ruling on TBD-8): the em dash rule applies to the site's article pages only, the
// one list scripts/site-chrome.js ARTICLES names, and no skills/ page is one. So an em dash is not read
// here; every other barred word is read on the whole page, inside NVIDIA's quoted cells too.
const cellsOf = (row) => [...row.fields.Result.html.matchAll(/<q class="card-cell">([^<]*)<\/q>/g)].map((m) => decode(m[1]));

test('AC-14, AC-14a: no banned word, confidence language or band lexicon phrasing anywhere on any page, an em dash allowed since no skills/ page is an article; every slot bounded and escaped', async () => {
  process.env.SPEC031_TMP = process.env.SPEC031_TMP || tmp('s031');
  const { LEXICON } = await import(pathToFileURL(path.join(ROOT, 'specs', '031-artefact-claims', 'probes', 'bands.mjs')).href);
  const { isArticle } = require('../scripts/site-chrome');
  const { ws, out } = await base();
  const scan = (html) => {
    const hits = [];
    for (const s of partsOf(html)) {
      if (BANNED.test(s)) hits.push(`banned: ${s.slice(0, 60)}`);
      if (CONFIDENCE.test(s)) hits.push(`confidence: ${s.slice(0, 60)}`);
      for (const { cls, re } of LEXICON) if (re.test(s)) hits.push(`lexicon ${cls}: ${s.slice(0, 60)}`);
    }
    return hits;
  };
  for (const [p, html] of out.pages) assert.deepEqual(scan(html), [], p);
  // The ruling's list: findings/ and every report page are articles; no page under skills/ is.
  assert.ok(isArticle('findings/index.html') && isArticle('reports/011/index.html'), 'ARTICLES names findings/ and reports/');
  for (const p of out.pages.keys()) assert.ok(!isArticle(`skills/${p}`), `skills/${p} is not an article`);
  // Each NVIDIA row quotes every card cell, in the card's order, as printed.
  for (const n of NV) {
    const row = rowsOf(out.pages.get(pagePath(n.identity))).find((x) => x.receipt === n.file);
    assert.deepEqual(cellsOf(row), readJson(ws.file(n.file)).source_figures.rows.map((x) => x.printed), `${n.file}: the quoted cells`);
  }
  const [, sample] = [...out.pages][0];
  for (const plant of ['bad', 'broken', 'useless', 'fails', '95% confidence']) assert.notDeepEqual(scan(sample.replace('</main>', `<p>${plant}</p></main>`)), [], plant);
  if (ldStrings(sample).length) assert.notDeepEqual(scan(sample.replace(/("name"\s*:\s*")/, '$1broken ')), []);
  // The newer card's no-uplift cell, which prints an em dash, is built and quoted as printed; an em
  // dash in a Driftproof-written text (G-3) reads green, since the page is not an article (A-267-4).
  const DASH = '62% — baseline ran, but no comparable score was available; uplift unavailable';
  const dws = workspace({ before: (w) => reseal(w, NV[3].file, (r) => { r.source_figures.rows[0].printed = DASH; r.source_figures.rows[1].printed = DASH; }) });
  const dash = await build(dws);
  const dPage = dash.pages.get(pagePath(NV[3].identity));
  const dRow = rowsOf(dPage).find((x) => x.receipt === NV[3].file);
  assert.ok(dRow.fields.Result.text.includes(`Overall: ${DASH}`), dRow.fields.Result.text);
  assert.deepEqual(cellsOf(dRow), [DASH, DASH]);
  assert.deepEqual(scan(dPage), []);
  assert.deepEqual(scan(dPage.replace(TX.G3, TX.G3.replace('Each result has its own test record.', 'Each result has its own test record — always.'))), []);
  // A barred word inside a quoted cell is still read.
  assert.notDeepEqual(scan(dPage.replace('<q class="card-cell">', '<q class="card-cell">fails </q><q class="card-cell">')), []);
  // AC-14a: a slot is escaped where it is written.
  const esc = await build(workspace({ before: (w) => reseal(w, NV[0].file, (r) => { r.source_figures.rows[1].dimension = 'Correct<b>ness</b>'; r.results.cases.forEach((c) => { c.label = 'Correct<b>ness</b>'; }); }) }));
  const escRow = rowsOf(esc.pages.get(pagePath(NV[0].identity))).find((x) => x.receipt === NV[0].file);
  assert.doesNotMatch(escRow.fields.Result.html, /<b>/);
  assert.ok(escRow.fields.Result.text.includes('Correct<b>ness</b>: '));
  // AC-14a: a slot is refused for a barred word, its length, a control character or its name.
  const file = (n) => new RegExp(escapeRegExp(path.basename(n.file)));
  await refusesBoth(workspace({ before: (w) => reseal(w, NV[0].file, (r) => { r.source_figures.rows[1].printed = '51% → 84% (+33 points), significantly'; }) }), file(NV[0]));
  // An em dash in a dimension name is built (A-267-4).
  const dimDash = await build(workspace({ before: (w) => reseal(w, NV[0].file, (r) => { r.source_figures.rows[1].dimension = 'Correct — ness'; r.results.cases.forEach((c) => { c.label = 'Correct — ness'; }); }) }));
  assert.ok(rowsOf(dimDash.pages.get(pagePath(NV[0].identity))).find((x) => x.receipt === NV[0].file).fields.Result.text.includes('Correct — ness: '));
  await refusesBoth(workspace({ before: (w) => { const v = readJson(w.file('index-receipts/skill-placebo/claude-code.json')); v.comparisons[SP_ARMS[0].key].verdict = 'n'.repeat(201); write(w.file('index-receipts/skill-placebo/claude-code.json'), JSON.stringify(v, null, 2)); } }), /verdict/);
  const sp0 = `index-receipts/skill-placebo/${SP_ARMS[0].arm}.json`;
  await refusesBoth(workspace({ before: (w) => reseal(w, sp0, (r) => { r.run.harness.version = '2.1.282\nx'; }) }), /harness|version/);
  await refusesBoth(workspace({ arms: (list) => { list[0].identity = { ...list[0].identity, repo: 'broken-link-checker' }; list[0].name = 'broken-link-checker'; } }), /broken-link-checker/);
});

// ══ AC-24 ════════════════════════════════════════════════════════════════════════════════════
// A-267-5 (approval finding F-2 at 88ad2bc0): a page whose rows are all reported says "measured"
// nowhere; a page with a measured row keeps its words. LABELS.REPORTED ("Reported, not measured") is
// the one text that carries the word, to say no measurement was made, so it is taken out first.
const measuredWords = (html) => partsOf(html).map((s) => s.split(LABELS.REPORTED).join(' ')).filter((s) => /\bmeasured\b/i.test(s)).map((s) => s.slice(0, 80));
// Where a page's verb words disagree with its receipts: [] when they agree. `verb` is the page's,
// `rowVerb(file)` a row's, each read from the receipts.
function verbFaults(html, verb, rowVerb) {
  const faults = verb === 'Reported' ? measuredWords(html).map((s) => `"measured" on a reported page: ${s}`) : [];
  const rows = rowsOf(html);
  if (rows.length) {
    const h1 = textOf((/<h1>([\s\S]*?)<\/h1>/.exec(html) || [null, ''])[1]);
    const d = descOf(html) || '';
    if (!h1 || !html.includes(`<h2>${verb} results</h2>`)) faults.push(`result heading: ${h1}`);
    if (!d.startsWith(`${verb} results for `)) faults.push(`description: ${d}`);
  }
  for (const row of rows) {
    const v = rowVerb(row.receipt);
    if (row.order[0] !== byField(v)) faults.push(`${row.receipt}: the first field is ${row.order[0]}`);
    const fr = row.fields.Freshness ? row.fields.Freshness.text : '';
    if (fr !== TX.F5 && !fr.startsWith(`${v} on `)) faults.push(`${row.receipt}: ${fr}`);
  }
  return faults;
}

test('AC-24: a page whose rows are all reported says "measured" nowhere, and a page with a measured row keeps its words, on the fixture build and on the committed pages', async () => {
  const { ws, out } = await base();
  const rowVerb = (f) => verbOf(readJson(ws.file(f)));
  const entriesAt = (p) => ws.manifest.receipts.filter((e) => pagePath(e.identity) === p);
  const kinds = new Set();
  for (const [p, html] of out.pages) {
    const verb = pageVerb(ws, p === 'index.html' ? ws.manifest.receipts : entriesAt(p));
    if (p !== 'index.html') kinds.add(verb);
    assert.deepEqual(verbFaults(html, verb, rowVerb), [], p);
  }
  assert.deepEqual([...kinds].sort(), ['Measured', 'Reported'], 'the fixture build holds both kinds of page');
  // The committed pages under docs/skills, each read against the committed receipts it lists.
  const m = readJson(path.join(ROOT, 'index-receipts', 'sources.json'));
  const committedVerb = (f) => verbOf(readJson(path.join(ROOT, f)));
  const committed = new Map();
  for (const e of m.receipts) { const p = pagePath(e.identity); committed.set(p, [...(committed.get(p) || []), e]); }
  const seen = new Set();
  for (const [p, entries] of committed) {
    const f = path.join(ROOT, 'docs', 'skills', p);
    if (!fs.existsSync(f)) continue; // a held identity has no page (AC-9)
    const verb = entries.some((e) => committedVerb(e.file) === 'Measured') ? 'Measured' : 'Reported';
    assert.deepEqual(verbFaults(fs.readFileSync(f, 'utf8'), verb, committedVerb), [], `docs/skills/${p}`);
    seen.add(verb);
  }
  assert.deepEqual([...seen].sort(), ['Measured', 'Reported'], 'the committed pages hold both kinds of page');
  // Plants on a reported-only NVIDIA page: "Measured" in G-1, in the first field, in a freshness line.
  const nvP = pagePath(NV[0].identity);
  const nvPage = out.pages.get(nvP);
  assert.equal(pageVerb(ws, entriesAt(nvP)), 'Reported');
  assert.notDeepEqual(verbFaults(nvPage.replace('<h2>Reported results</h2>', '<h2>Measured results</h2>'), 'Reported', rowVerb), []);
  assert.notDeepEqual(verbFaults(nvPage.replace('<dt>Reported by</dt>', '<dt>Measured by</dt>'), 'Reported', rowVerb), []);
  assert.notDeepEqual(verbFaults(nvPage.replace('Reported on ', 'Measured on '), 'Reported', rowVerb), []);
  // A skill-placebo page reads green with its label "Reported, not measured", and red with the word
  // anywhere else; a plugin page's G-2 says "reported as one bundle".
  const spPage = out.pages.get(pagePath(SP_ARMS[0].identity));
  assert.ok(textOf(spPage).includes(LABELS.REPORTED));
  assert.notDeepEqual(verbFaults(spPage.replace('</main>', '<p>Measured by skill-placebo.</p></main>'), 'Reported', rowVerb), []);
  const plug = SP_ARMS.find((a) => a.identity.unit === 'plugin');
  const plugPage = out.pages.get(pagePath(plug.identity));
  assert.ok(textOf(plugPage).includes(TX.G2('Reported', plug.identity)));
  assert.notDeepEqual(verbFaults(plugPage.replace(TX.G2('Reported', plug.identity), TX.G2('Measured', plug.identity)), 'Reported', rowVerb), []);
  // A measured page keeps its words; each turned to "Reported" reads RED.
  const dpPage = out.pages.get(pagePath(entryOf(ws, DP[0].file).identity));
  assert.deepEqual(verbFaults(dpPage, 'Measured', rowVerb), []);
  for (const [from, to] of [['Measured results', 'Reported results'], ['<dt>Measured by</dt>', '<dt>Reported by</dt>'], ['Measured on ', 'Reported on ']]) {
    assert.ok(dpPage.includes(from), from);
    assert.notDeepEqual(verbFaults(dpPage.split(from).join(to), 'Measured', rowVerb), [], from);
  }
});

// ══ A-267-7 (issue 331, approval findings F-2 and F-3 at b41c5992) ═══════════════════════════
// R-5 says the receipt holds no uplift figure: read as "no uplift", it said NVIDIA reported an uplift
// of zero. The list page's title, P-2, carries no verb, since most of its entries are reported only;
// its head, where the title is copied (og:title, JSON-LD), says "measured" nowhere. Each is read on
// the fixture build and on every committed page under docs/skills.
const R5_HEAD = /NVIDIA reported a score of [0-9.]+% overall and no uplift( figure)? \(/g;
function wordingFaults(html, p) {
  const faults = [];
  for (const m of textOf(html).matchAll(R5_HEAD)) if (!m[1]) faults.push(`${p}: R-5 reads "${m[0]}"`);
  if (p === 'index.html') {
    const head = (/<head>[\s\S]*?<\/head>/.exec(html) || [''])[0];
    if (titleOf(html) !== TX.P2) faults.push(`${p}: the title is ${titleOf(html)}`);
    const parts = [titleOf(html) || '', ...attrsOf(head).filter((a) => !['href', 'src'].includes(a.name)).map((a) => a.value), ...ldStrings(head)];
    for (const s of parts) if (/\bmeasured\b/i.test(s)) faults.push(`${p}: the head reads "${s.slice(0, 80)}"`);
  }
  return faults;
}



// ══ AC-15 ════════════════════════════════════════════════════════════════════════════════════
test('AC-15: the module exports two names, the build date is checked first, the CLI refuses unknown flags, and no workflow or pipeline stage names the builder', async () => {
  const mod = await loadBuilder();
  assert.deepEqual(Object.keys(mod).sort(), ['SkillIndexRefused', 'buildSkillIndex']);
  for (const d of ['2026-13-01', '2026-02-30', '<x>']) await refusesBoth(workspace(), /build date|build-date/, d);
  const r = cli(['--schedule']);
  assert.equal(r.status, 2);
  const wf = path.join(ROOT, '.github', 'workflows');
  for (const f of fs.existsSync(wf) ? fs.readdirSync(wf) : []) assert.doesNotMatch(fs.readFileSync(path.join(wf, f), 'utf8'), /build-skill-index/, f);
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'scripts', 'pipeline.mjs'), 'utf8'), /build-skill-index/);
  // The bytes returned are the published page: the chrome and the head block are on it.
  const { out } = await base();
  const html = out.pages.get('index.html');
  assert.equal(outsideMain(html), chromeOf('index.html').outside);
  assert.match(html, /<link rel="canonical" href="https:\/\/driftproofhq\.com\/skills\/">/);
});

// ══ AC-16 ════════════════════════════════════════════════════════════════════════════════════
test('AC-16: the same receipts give the same pages, the build date aside, whatever the order read', async () => {
  const { ws, out } = await base();
  const later = await build(ws, '2026-10-15');
  assert.deepEqual([...later.files.keys()].sort(), [...out.files.keys()].sort());
  for (const [p, b] of out.files) {
    const a = b.toString('utf8'); const c = later.files.get(p).toString('utf8');
    if (p.endsWith('.html')) {
      assert.equal(stripBuildDate(c), stripBuildDate(a), p);
      assert.equal((a.match(/<time data-build-date /g) || []).length, 1, `${p}: one build date`);
      assert.ok(!stripBuildDate(a).includes(BUILD_DATE), `${p}: the build date appears only in its <time>`);
    } else assert.ok(later.files.get(p).equals(b), p);
  }
  const rev = workspace({ before: (w) => { w.manifest.receipts.reverse(); w.manifest.sources = [...w.manifest.sources]; } });
  const rb = await build(rev);
  for (const [p, b] of out.files) assert.ok(rb.files.get(p) && rb.files.get(p).equals(b), `reversed manifest: ${p}`);
  // A reversed listing, seen by an ESM named import too, and seen to be called on a report folder.
  const lws = workspace();
  const orig = fs.readdirSync;
  const calls = [];
  fs.readdirSync = function reversed(...args) { calls.push(String(args[0])); const r = orig.apply(this, args); return Array.isArray(r) ? r.slice().reverse() : r; };
  nodeModule.syncBuiltinESMExports();
  let lb;
  try { lb = await build(lws); } finally { fs.readdirSync = orig; nodeModule.syncBuiltinESMExports(); }
  const calledOnReport = (list) => list.some((c) => /receipts[\\/]report-0(09|11|13|14)/.test(c));
  assert.ok(calledOnReport(calls), `the patched readdirSync was called on a report folder: ${calls.slice(0, 5).join(', ')}`);
  assert.ok(!calledOnReport([]), 'a patch left uncalled fails the same check');
  for (const [p, b] of out.files) assert.ok(lb.files.get(p) && lb.files.get(p).equals(b), `reversed listing: ${p}`);
  // --check: a stale page left from an identity no longer listed exits 1.
  const ck = workspace();
  const dir = path.join(ck.root, 'docs', 'skills');
  assert.equal(cli(['--root', ck.root, '--out', dir, '--build-date', BUILD_DATE]).status, 0);
  assert.equal(cli(['--root', ck.root, '--out', dir, '--check']).status, 0);
  write(path.join(dir, 'gone', 'x', 'y', 'index.html'), '<!doctype html>\n');
  const r = cli(['--root', ck.root, '--out', dir, '--check']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /gone\/x\/y\/index\.html/);
});

// ══ AC-17, AC-18 ═════════════════════════════════════════════════════════════════════════════
test('AC-17, AC-18: rows written and held equal the manifest, which is every receipt; each row links to its receipt, page or byte copy', async () => {
  const { ws, out } = await base();
  const rows = [...out.pages].filter(([p]) => p !== 'index.html').flatMap(([, h]) => rowsOf(h));
  assert.equal(rows.length + out.held.length, ws.manifest.receipts.length);
  assert.deepEqual(rows.map((r) => r.receipt).sort(cmp16), ws.manifest.receipts.map((e) => e.file).sort(cmp16));
  assert.deepEqual(ws.manifest.receipts.filter((e) => e.source === 'driftproof').map((e) => e.file).sort(cmp16), DP_ALL.map((d) => d.file).sort(cmp16), 'every Driftproof receipt of the four reports');
  assert.equal(entriesOf(out.pages.get('index.html')).length, new Set(ws.manifest.receipts.map((e) => pagePath(e.identity))).size);
  for (const row of rows) {
    const e = entryOf(ws, row.receipt);
    const r = readJson(ws.file(e.file));
    const k = tasksAndRuns(r);
    if (!marked(r)) assert.ok(row.fields['Tasks and runs'].text.startsWith(TX.K1(k.tasks, k.w, k.b)), `${row.receipt}: counts`);
    const link = /href="([^"]*)"/.exec(row.fields.Receipt.html)[1];
    if (e.source === 'driftproof') {
      assert.equal(link, `/r/${r.receipt_hash}/`);
      assert.ok(fs.existsSync(ws.file(`docs/r/${r.receipt_hash}/index.html`)));
    } else {
      assert.equal(link, `/skills/receipts/${e.source}/${path.basename(e.file)}`);
      assert.ok(out.files.get(`receipts/${e.source}/${path.basename(e.file)}`).equals(fs.readFileSync(ws.file(e.file))), e.file);
    }
  }
  // Plant: a run count doctored by one is seen.
  const r0 = readJson(ws.file(DP[0].file)); const k0 = tasksAndRuns(r0);
  assert.notEqual(TX.K1(k0.tasks, k0.w + 1, k0.b), TX.K1(k0.tasks, k0.w, k0.b));
});

// ══ AC-21 ════════════════════════════════════════════════════════════════════════════════════


// ══ AC-22 ════════════════════════════════════════════════════════════════════════════════════
test('AC-22: the committed docs/skills is the built tree, and the derived files pass their builders\' checks', () => {
  for (const args of [[BUILDER, '--check'], [path.join(ROOT, 'scripts', 'build-head-tags.js'), '--check'], [path.join(ROOT, 'scripts', 'build-sitemap.js'), '--check']]) {
    const r = spawnSync(process.execPath, args, { encoding: 'utf8', cwd: ROOT });
    assert.equal(r.status, 0, `${path.basename(args[0])}: ${r.stderr.slice(0, 400)}`);
  }
});

// ══ AC-23 ════════════════════════════════════════════════════════════════════════════════════


test('AC-2: source records match their declared provenance hashes', () => {
  const m = readJson(path.join(ROOT, 'index-receipts', 'sources.json'));
  const sp = m.sources.find((s) => s.id === 'skill-placebo');
  for (const k of ['verdicts', 'identity_record']) assert.equal(blobSha1(fs.readFileSync(path.join(ROOT, sp[k].file))), sp[k].git_blob_sha1, k);
});

test('AC-23: a registry change turns the actual index check red', () => {
  const ws = workspace();
  const dir = path.join(ws.root, 'docs', 'skills');
  assert.equal(cli(['--root', ws.root, '--out', dir, '--build-date', BUILD_DATE]).status, 0);
  const reg = readJson(path.join(ROOT, 'config', 'models.json'));
  reg.models.unshift({ ...reg.models.find((m) => m.id === 'claude-opus-5-5'), id: 'claude-opus-9-9', released: '2026-10-01' });
  const regFile = path.join(tmp('reg'), 'models.json');
  write(regFile, JSON.stringify(reg));
  assert.equal(cli(['--root', ws.root, '--out', dir, '--check'], { DRIFTPROOF_REGISTRY: regFile }).status, 1);
});
