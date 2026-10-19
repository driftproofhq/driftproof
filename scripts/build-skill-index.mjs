#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// scripts/build-skill-index.mjs - the skill index, "Worth installing?" pages at /skills/ (spec 267).
//
// One page per skill identity, one row per committed receipt of it, every figure read from that
// receipt and every word from a fixed text of spec 267 or from the repository's existing readers
// (lib/plain.js plainOf, lib/stale.js advisories, scripts/model-names.js). The inputs are the files
// index-receipts/sources.json lists, each pinned by its sha256 and checked in the order AC-1 gives;
// a check that fails refuses the whole build, and nothing is written.
//
// No figure on a page combines two receipts. An NVIDIA receipt carries the card's figures as
// printed and no verdict word. A skill whose recomputed direction is opposite to its source's own
// verdict is held: no page, no list entry, no copied receipt (AC-9).
//
//   node scripts/build-skill-index.mjs [--root DIR] [--out DIR] [--build-date YYYY-MM-DD] [--check]
//
// Imports are commands someone runs (index-receipts/README.md); this builder is never a scheduled
// job or a pipeline stage (AC-15).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');

const { publication: campaignPublication } = require('../specs/408-skill-measurements/campaign.cjs');
const { plainOf, LABELS } = require('../lib/plain');
const { armOf, receiptAggregatesOnly } = require('../lib/verdict');
const { bandOf } = require('../lib/reuse');
const { advisories } = require('../lib/stale');
const { loadRegistry } = require('../lib/models');
const { validateReceipt, verifyReceiptHash } = require('../lib/receipt');
const { opposedToPublished } = require('../lib/importers-harbor');
const { humanModelName, shortModelName } = require('./model-names.js');
const { applyHeadTags } = require('./build-head-tags.js');

// Spec 031's band lexicon, the one the claims discipline reads (AC-14). It lives with that spec, so
// the builder runs in the source tree, as AC-23 says.
let LEXICON = null;
try { ({ LEXICON } = await import(pathToFileURL(path.join(REPO, 'specs', '031-artefact-claims', 'probes', 'bands.mjs')).href)); } catch { LEXICON = null; }

export class SkillIndexRefused extends Error {}
const refuse = (msg) => { throw new SkillIndexRefused(msg); };

const ORIGIN = 'https://driftproofhq.com';
const SOURCES = ['driftproof', 'skill-placebo', 'nvidia'];
const LICENCES = { driftproof: 'Apache-2.0', 'skill-placebo': 'MIT', nvidia: 'CC-BY-4.0' };
const REPORTS = ['009', '011', '013', '014'];
const DEED = 'https://creativecommons.org/licenses/by/4.0/';
const DISPUTE = 'https://github.com/driftproofhq/driftproof/issues/new';
const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const PLAIN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const RESERVED = ['receipts', 'index.html'];
const UNITS = ['skill', 'plugin'];
const TITLE_MAX = 60;
const DESC_MAX = 155;
const SLOT_MAX = 200;
// The words AC-14 bars, and confidence language as spec 035's surfaces read it, with the adverbs
// added (AC-14a's plant: a cell carrying "significantly" is refused).
const BANNED = /\b(bad|broken|useless|fails)\b/i;
const CONFIDENCE = /\bconfiden(t|tly|ce)\b|\bsignifican(t|tly|ce)\b/i;
const CONTROL = /[\u0000-\u001f\u007f]/;

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const blobSha1 = (b) => crypto.createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex');
const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const shown = (v) => JSON.stringify(String(v).slice(0, 80));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const isObject = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const num = (x) => typeof x === 'number' && Number.isFinite(x);

// ── the fixed texts (spec 267 § The fixed texts and § The page texts) ─────────────────────────
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const signed = (x) => (x > 0 ? `+${x}` : `${x}`);
const n3 = (x) => (typeof x === 'number' ? x.toFixed(3) : 'no score');
const TX = {
  W1: (report) => `Measured by Driftproof, Report ${report}`,
  W2: 'Recomputed by Driftproof from skill-placebo\'s published trials',
  W3: 'Reported by NVIDIA in its benchmark card',
  H1: (v, s) => `Driftproof runner ${v} on ${s}`,
  H2: (n, v) => `${n} ${v}`,
  H3: (n) => `${n}, version not stated`,
  R2: (w, b, t) => `Recomputed by Driftproof from skill-placebo's trial files: ${w} with the skill and ${b} without, on ${plural(t, 'task')}. The receipt is DECLARED, so Driftproof gives it no verdict.`,
  R3: (v) => `skill-placebo's own verdict: "${v}". It compares the skill with a placebo skill, on pass rate and cost; the figures in the result compare it with no skill, on reward.`,
  R4: (u, a) => `NVIDIA reported ${signed(u)} points overall (${a}).`,
  // R-5 (A-267-7, issue 331): the receipt holds no uplift figure, which is not an uplift of zero.
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
  G3: 'Each result has its own test record. Results are not combined.',
  G4: 'Worth installing?',
  G5: 'Browse skills and open their test results.',
  // G-6 (A-267-6, issue 315): the list page's link to the skill lookup, *Look it up* linked.
  G6: ['Have a GitHub link to a skill? ', 'Look it up', '.'],
  D1: 'Disagree, or want a re-run?',
  P1: (verb, name, id, sources) => `${verb} results for ${name} (${id.owner}/${id.repo}) from ${sources}, one row per receipt, in plain words.`,
  // P-2 (A-267-7, issue 331): one title, no verb, since most entries are reported only.
  P2: 'Agent skills: worth installing? | Driftproof',
  P3: 'We test AI skills on written tasks. See what helped, what hurt, and where more answers are needed.',
  NVLABEL: 'NVIDIA\'s figures',
  noCommit: 'skill commit not recorded',
};
const G2 = (verb, id) => (id.path ? `Skill ${id.path} in ${id.owner}/${id.repo}.` : id.unit === 'plugin' ? `Plugin ${id.owner}/${id.repo}, ${verb.toLowerCase()} as one bundle.` : `Skill at the root of ${id.owner}/${id.repo}.`);
// The verb a row or page carries (A-267-5): "Measured" only where a row is TESTED, a receipt Driftproof
// measured; "Reported" where every row is DECLARED, figures a source reported.
const verbOf = (measured) => (measured ? 'Measured' : 'Reported');
const FIELDS = ['by', 'Model', 'Date', 'Result', 'Tasks and runs', 'Receipt', 'Source\'s verdict', 'Harness', 'Tokens', 'Freshness', 'Skill commit'];
const SETS = { source: SOURCES, evidence: ['measured', 'recomputed', 'aggregates-only'], freshness: ['newer', 'no-newer', 'unknown'] };

// ── slots (AC-14a): text a fixed text takes from a source, bounded, read for barred words, escaped ──
function slot(file, field, value) {
  const s = String(value);
  const why = CONTROL.test(s) ? 'holds a control character'
    : s.length > SLOT_MAX ? `is ${s.length} characters, over ${SLOT_MAX}`
      : BANNED.test(s) ? `carries the word "${BANNED.exec(s)[1]}"`
        : CONFIDENCE.test(s) ? 'carries confidence language'
          : (LEXICON.find(({ re }) => re.test(s)) ? `carries a phrasing of spec 031's band lexicon (${LEXICON.find(({ re }) => re.test(s)).cls})` : null);
  if (why) refuse(`${file}: ${field}: the slot ${shown(s)} ${why}`);
  return s;
}

// ── reading ───────────────────────────────────────────────────────────────────────────────────
const rel = (root, f) => path.relative(root, f).split(path.sep).join('/');
function readBytes(root, p, what) {
  const f = path.join(root, p);
  if (!fs.existsSync(f) || !fs.statSync(f).isFile()) refuse(`${p}: ${what} does not exist`);
  return fs.readFileSync(f);
}
function readJsonAt(root, p, what) {
  const b = readBytes(root, p, what);
  try { return { bytes: b, doc: JSON.parse(b.toString('utf8')) }; } catch { return refuse(`${p}: ${what} is not JSON`); }
}
// Every .json file under a folder, read with fs.readdirSync and put in path order, so the listing
// the system returns never changes a page (AC-16).
function walkJson(root, dir) {
  const d = path.join(root, dir);
  if (!fs.existsSync(d)) return [];
  const out = [];
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const f = path.join(d, e.name);
    if (e.isDirectory()) out.push(...walkJson(root, rel(root, f)));
    else if (e.isFile() && e.name.endsWith('.json')) out.push(rel(root, f));
  }
  return out.sort(byCodeUnit);
}

// ── AC-1: each listed file, in manifest order, then the manifest-wide checks ──────────────────
function checkFile(root, e, sources) {
  const f = e.file;
  if (typeof f !== 'string' || !f) refuse('a manifest entry names no file');
  if (!SOURCES.includes(e.source) || !sources.has(e.source)) refuse(`${f}: source ${shown(e.source)} is not a source the manifest names`);
  const at = path.join(root, f);
  if (!fs.existsSync(at) || !fs.statSync(at).isFile()) refuse(`${f}: the file does not exist`);
  const bytes = fs.readFileSync(at);
  if (!HEX64.test(String(e.sha256)) || sha256(bytes) !== e.sha256) refuse(`${f}: its sha256 is ${sha256(bytes)}, the manifest's is ${shown(e.sha256)}`);
  if (e.source === 'driftproof') {
    const m = /^receipts\/report-(\d{3})\/.+\.json$/.exec(f);
    if (!m || !REPORTS.includes(m[1])) refuse(`${f}: a Driftproof receipt is under receipts/report-009/, report-011/, report-013/ or report-014/`);
    if (e.report !== m[1]) refuse(`${f}: its manifest report is ${shown(e.report)}, its folder's is ${m[1]}`);
  } else if (!f.startsWith(`index-receipts/${e.source}/`) || !f.endsWith('.json') || f.includes('/../')) refuse(`${f}: an imported ${e.source} receipt is under index-receipts/${e.source}/`);
  let r;
  try { r = JSON.parse(bytes.toString('utf8')); } catch { refuse(`${f}: not JSON`); }
  if (!isObject(r) || !isObject(r.run)) refuse(`${f}: not a receipt`);
  const marked = receiptAggregatesOnly(r);
  if (e.source === 'driftproof') {
    if (r.run.source !== undefined) refuse(`${f}: a Driftproof receipt carries no run.source (it carries ${shown(r.run.source)})`);
    if (r.run.import !== undefined) refuse(`${f}: a Driftproof receipt carries no run.import`);
    if (marked) refuse(`${f}: a Driftproof receipt is not marked aggregates only`);
    if (r.verification_level !== 'TESTED') refuse(`${f}: a Driftproof receipt's verification_level is TESTED here, not ${shown(r.verification_level)}: no fixed text gives another`);
    if (typeof r.receipt_hash !== 'string' || !HEX64.test(r.receipt_hash) || !fs.existsSync(path.join(root, 'docs', 'r', r.receipt_hash, 'index.html'))) refuse(`${f}: it has no receipt page at docs/r/${String(r.receipt_hash).slice(0, 64)}/index.html`);
  } else if (e.source === 'skill-placebo') {
    if (r.run.source !== 'imported/harbor') refuse(`${f}: a skill-placebo receipt's run.source is imported/harbor, not ${shown(r.run.source)}`);
    if (r.verification_level !== 'DECLARED') refuse(`${f}: a skill-placebo receipt's verification_level is DECLARED, not ${shown(r.verification_level)}`);
    if (marked) refuse(`${f}: a skill-placebo receipt is not marked aggregates only`);
  } else {
    if (r.run.source !== 'imported/nvidia-cards') refuse(`${f}: an NVIDIA receipt's run.source is imported/nvidia-cards, not ${shown(r.run.source)}`);
    if (r.verification_level !== 'DECLARED') refuse(`${f}: an NVIDIA receipt's verification_level is DECLARED, not ${shown(r.verification_level)}`);
    if (!marked || !isObject(r.source_figures)) refuse(`${f}: an NVIDIA receipt is marked aggregates only and carries source_figures`);
  }
  const v = validateReceipt(r);
  if (!v.valid) refuse(`${f}: it does not validate against schema ${shown(r.schema_version)}: ${(v.errors || []).slice(0, 2).map((x) => `${x.instancePath || ''} ${x.message || ''}`.trim()).join('; ')}`);
  if (!verifyReceiptHash(r)) refuse(`${f}: its receipt_hash does not verify against its content`);
  return r;
}

function checkSources(m) {
  if (!isObject(m) || !Array.isArray(m.sources) || !Array.isArray(m.receipts)) refuse('index-receipts/sources.json: sources and receipts are lists');
  const ids = m.sources.map((s) => s && s.id);
  if (JSON.stringify(ids) !== JSON.stringify(SOURCES)) refuse(`index-receipts/sources.json: the sources are ${SOURCES.join(', ')}, in that order`);
  for (const s of m.sources) {
    if (s.licence !== LICENCES[s.id]) refuse(`index-receipts/sources.json: ${s.id}'s licence is ${LICENCES[s.id]}`);
    if (typeof s.name !== 'string' || !s.name || typeof s.repo !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(s.repo)) refuse(`index-receipts/sources.json: ${s.id} names no name and repository`);
    if (s.id === 'driftproof' ? s.commit !== null : !HEX40.test(String(s.commit))) refuse(`index-receipts/sources.json: ${s.id}'s commit is ${s.id === 'driftproof' ? 'null' : '40 lowercase hex'}`);
  }
  return new Map(m.sources.map((s) => [s.id, s]));
}

// The skill-placebo verdicts file and install record, each the blob the manifest pins (AC-2).
function pinnedFile(root, s, key) {
  const x = s[key];
  if (!isObject(x) || typeof x.file !== 'string') refuse(`index-receipts/sources.json: skill-placebo names no ${key}`);
  const { bytes, doc } = readJsonAt(root, x.file, `the skill-placebo ${key}`);
  if (blobSha1(bytes) !== x.git_blob_sha1) refuse(`${x.file}: its git blob sha1 is ${blobSha1(bytes)}, the manifest's is ${shown(x.git_blob_sha1)}`);
  return doc;
}

// ── AC-3: each identity from its source's own record ──────────────────────────────────────────
function driftproofRecord(root, s) {
  const ir = s.identity_record || {};
  const proto = readBytes(root, ir.protocol, 'Report 009\'s protocol').toString('utf8');
  const pm = /Three skills from ([^/\s]+)\/(\S+) commit ([0-9a-f]{40}): ([^.\n]+)\./.exec(proto);
  if (!pm) refuse(`${ir.protocol}: no line "Three skills from <owner>/<repo> commit <commit>: <names>."`);
  const names = pm[4].split(',').map((x) => x.trim());
  const up = readBytes(root, ir.upstream, 'spec 034\'s upstream record').toString('utf8');
  const paths = new Map();
  for (const m of up.matchAll(/^(\S+) \| https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([0-9a-f]{40})\/(\S+)\/SKILL\.md \|/gm)) {
    if (m[2] !== pm[1] || m[3] !== pm[2] || m[4] !== pm[3]) refuse(`${ir.upstream}: ${m[1]} names ${m[2]}/${m[3]} at ${m[4]}, the protocol ${pm[1]}/${pm[2]} at ${pm[3]}`);
    paths.set(m[1], m[5]);
  }
  return { owner: pm[1], repo: pm[2], commit: pm[3], names, paths };
}

function identityOf(e, r, rec, lock) {
  const f = e.file;
  const id = e.identity;
  if (!isObject(id)) refuse(`${f}: the manifest entry carries no identity`);
  for (const k of ['owner', 'repo']) if (typeof id[k] !== 'string' || !PLAIN.test(id[k])) refuse(`${f}: identity.${k} ${shown(id[k])} is not a plain name (a letter or digit, then letters, digits, ., _ or -)`);
  if (typeof id.path !== 'string') refuse(`${f}: identity.path is a string`);
  const segs = id.path ? id.path.split('/') : [];
  for (const sg of segs) if (!PLAIN.test(sg)) refuse(`${f}: identity.path segment ${shown(sg)} is not a plain name`);
  for (const sg of [id.owner, id.repo, ...segs]) if (RESERVED.includes(sg.toLowerCase())) refuse(`${f}: the identity segment ${shown(sg)} is reserved (receipts, index.html)`);
  if (!UNITS.includes(id.unit)) refuse(`${f}: identity.unit is skill or plugin, not ${shown(id.unit)}`);
  const want = e.source === 'driftproof' ? (() => {
    const p = rec.driftproof.paths.get(e.name);
    if (!rec.driftproof.names.includes(e.name) || !p) refuse(`${f}: the name ${shown(e.name)} is not one Report 009's protocol and spec 034's upstream record name`);
    return { owner: rec.driftproof.owner, repo: rec.driftproof.repo, path: p, commit: rec.driftproof.commit };
  })() : e.source === 'skill-placebo' ? (() => {
    const l = lock.get(e.verdict_key);
    if (!l) refuse(`${f}: the install record ${rec.lockFile} names no arm ${shown(e.verdict_key)}`);
    const m = /^([^/]+)\/([^/]+)$/.exec(String(l.repo));
    if (!m || !HEX40.test(String(l.sha))) refuse(`${rec.lockFile}: the arm ${shown(e.verdict_key)} names no <owner>/<repo> and 40-hex sha`);
    return { owner: m[1], repo: m[2], path: '', commit: l.sha };
  })() : (() => {
    const src = r.source_figures.source || {};
    const m = /^([^/]+)\/([^/]+)$/.exec(String(src.repo));
    const card = Array.isArray(src.files) && src.files[0] ? String(src.files[0].path) : '';
    const cm = /^(.+)\/BENCHMARK\.md$/.exec(card);
    if (!m || !cm) refuse(`${f}: source_figures.source names no repository and card path`);
    if (src.commit !== rec.nvidiaCommit) refuse(`${f}: source_figures.source.commit is ${shown(src.commit)}, the manifest pins ${rec.nvidiaCommit}`);
    return { owner: m[1], repo: m[2], path: cm[1], commit: src.commit };
  })();
  for (const k of ['owner', 'repo', 'path']) if (id[k] !== want[k]) refuse(`${f}: identity.${k} is ${shown(id[k])}, its record's is ${shown(want[k])}`);
  if (e.skill_commit !== want.commit) refuse(`${f}: skill_commit is ${shown(e.skill_commit)}, its record's is ${shown(want.commit)}`);
  const name = id.path ? segs[segs.length - 1] : id.repo;
  if (e.name !== name) refuse(`${f}: the manifest name ${shown(e.name)} is not ${shown(name)}, the last segment of its path`);
  if (e.source !== 'nvidia' && (!r.skill || r.skill.name !== name)) refuse(`${f}: skill.name ${shown(r.skill && r.skill.name)} is not the identity's name ${shown(name)}`);
  return { owner: id.owner, repo: id.repo, path: id.path, unit: id.unit, name, page: `${id.owner}/${id.repo}/${name}` };
}

// ── what a row says ───────────────────────────────────────────────────────────────────────────
function tasksAndRuns(r) {
  const byId = new Map();
  for (const c of (r.results && r.results.cases) || []) {
    if (c.case_status && c.case_status !== 'ok') continue;
    const x = byId.get(c.id) || {};
    x[c.mode] = c;
    byId.set(c.id, x);
  }
  // A task is a case whose two arms the verdict reads; its runs are the runs each row records, not
  // armOf's count, which reads an imported case as one draw.
  const runs = (row) => { const band = bandOf(row); return band.source === 'generation' ? band.n : Number.isInteger(band.n) && band.n > 0 ? band.n : 1; };
  let tasks = 0; let w = 0; let b = 0;
  for (const [, x] of byId) {
    const aw = armOf(x.with_skill); const ab = armOf(x.baseline);
    if (!aw || !ab) continue;
    tasks++; w += runs(x.with_skill); b += runs(x.baseline);
  }
  const left = ((r.results && r.results.cases) || []).reduce((s, c) => s + (Array.isArray(c.excluded_draws) ? c.excluded_draws.length : 0), 0);
  return { tasks, w, b, left };
}

function checkAliases(aliases) {
  if (!isObject(aliases)) refuse('index-receipts/sources.json: model_aliases is an object');
  for (const [from, to] of Object.entries(aliases)) {
    const last = from.split('/').pop().replace(/^bedrock-/, '');
    if (last !== to || typeof to !== 'string') refuse(`index-receipts/sources.json: the model alias ${shown(from)} to ${shown(to)} is not its last segment less bedrock-`);
    if (!/^[A-Za-z0-9._:@+/-]{1,128}$/.test(from)) refuse(`index-receipts/sources.json: the model alias ${shown(from)} is not a model id`);
  }
}

function modelText(f, r, aliases) {
  const id = slot(f, 'run.model_id', r.run.model_id);
  if (id === 'unknown') return 'model not stated';
  if (Object.hasOwn(aliases, id)) return `${humanModelName(aliases[id])} (${id}, as the source names it)`;
  try { return `${humanModelName(id)} (${id})`; } catch { return id; }
}
function freshnessOf(r, aliases, verb) {
  const id = r.run.model_id;
  if (id === 'unknown') return { text: TX.F5, value: 'unknown' };
  const regId = Object.hasOwn(aliases, id) ? aliases[id] : id;
  const reg = loadRegistry();
  const row = reg.byId[regId];
  if (!row) return { text: TX.F4(verb, id), value: 'unknown' };
  if (!(typeof row.released === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.released))) return { text: TX.F3(verb, shortModelName(regId)), value: 'unknown' };
  const newer = advisories({ run: { model_id: regId, date_utc: r.run.date_utc } }).slice().sort((a, b) => byCodeUnit(a.released, b.released) || byCodeUnit(a.model_id, b.model_id));
  if (!newer.length) return { text: TX.F2(verb, shortModelName(regId), row.family), value: 'no-newer' };
  return { text: TX.F1(verb, shortModelName(regId), row.family, newer.map((x) => shortModelName(x.model_id)).join(', ')), value: 'newer' };
}
function nvidiaHead(f, sf) {
  const a = TX.attempts(sf.attempts_per_task);
  const overall = sf.rows.find((x) => x.dimension === 'Overall');
  if (!overall) return TX.R6(a);
  if (overall.uplift_unit === 'points' && num(overall.uplift)) return TX.R4(overall.uplift, a);
  if (overall.uplift_unit === 'unstated') return TX.R8(slot(f, 'source_figures.rows[Overall].printed', overall.printed), a);
  if (overall.uplift === null && num(overall.score_pct)) return TX.R5(overall.score_pct, a);
  return refuse(`${f}: the card's Overall row fits no headline (R-4, R-5 or R-8)`);
}

// One row: each field's text, and its HTML. Every slot is checked and escaped here.
function rowOf(e, r, ctx) {
  const f = e.file;
  const src = ctx.sources.get(e.source);
  const fields = {};
  const html = {};
  const put = (k, text, h = esc(text)) => { fields[k] = text; html[k] = h; };
  const evidence = e.source === 'nvidia' ? 'aggregates-only' : r.verification_level === 'TESTED' ? 'measured' : 'recomputed';
  const verb = verbOf(evidence === 'measured');
  if (e.source === 'driftproof') {
    const t = TX.W1(slot(f, 'report', e.report));
    put('by', t, `<a href="/reports/${esc(e.report)}/">${esc(t)}</a>`);
  } else put('by', e.source === 'skill-placebo' ? TX.W2 : TX.W3);
  put('Model', modelText(f, r, ctx.aliases));
  if (e.source === 'driftproof') put('Harness', TX.H1(slot(f, 'run.runner_version', r.run.runner_version), slot(f, 'run.surface', r.run.surface)));
  else {
    const h = r.run.harness || {};
    const name = slot(f, 'run.harness.name', h.name);
    put('Harness', h.version !== null && h.version !== undefined ? TX.H2(name, slot(f, 'run.harness.version', h.version)) : TX.H3(name));
  }
  if (typeof r.run.date_utc !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(r.run.date_utc) || !Number.isFinite(Date.parse(r.run.date_utc))) refuse(`${f}: run.date_utc is not a date`);
  const date = r.run.date_utc.slice(0, 10);
  if (e.source === 'nvidia' && r.source_figures.evaluation_date !== date) refuse(`${f}: source_figures.evaluation_date ${shown(r.source_figures.evaluation_date)} is not run.date_utc's day ${date}`);
  put('Date', date);
  if (e.source === 'nvidia') {
    const sf = r.source_figures;
    if (!Array.isArray(sf.rows)) refuse(`${f}: source_figures.rows is a list`);
    put('Tasks and runs', TX.K3(sf.tasks));
    const cells = sf.rows.map((x, i) => ({ dim: slot(f, `source_figures.rows[${i}].dimension`, x.dimension), printed: slot(f, `source_figures.rows[${i}].printed`, x.printed) }));
    const head = [nvidiaHead(f, sf), ...(sf.rows.some((x) => x.uplift_unit === 'unstated') ? [TX.R7] : [])];
    put('Result', [...head, 'Dimension Printed cell', ...cells.map((c) => `${c.dim}: ${c.printed}`)].join(' '),
      head.map(esc).join(' ') + '<div class="skill-table-scroll"><table><thead><tr><th scope="col">Dimension</th><th scope="col">Printed cell</th></tr></thead><tbody>' + cells.map((c) => `<tr><th scope="row">${esc(c.dim)}:</th><td><q class="card-cell">${esc(c.printed)}</q></td></tr>`).join('') + '</tbody></table></div>');
    const tk = sf.tokens;
    put('Tokens', tk ? TX.T3(slot(f, 'source_figures.tokens.with_skill', tk.with_skill), slot(f, 'source_figures.tokens.without_skill', tk.without_skill)) : TX.T4);
  } else {
    const k = tasksAndRuns(r);
    put('Tasks and runs', TX.K1(k.tasks, k.w, k.b) + (k.left ? TX.K2(k.left) : ''));
    const p = plainOf(r);
    if (evidence === 'measured') put('Result', [p.sentence, p.detail, p.why].filter(Boolean).join(' '));
    else {
      if (p.label !== LABELS.REPORTED) refuse(`${f}: a receipt below TESTED reads ${shown(p.label)}, not ${LABELS.REPORTED}`);
      put('Result', [`${LABELS.REPORTED}.`, TX.R2(n3(r.comparison.with_skill_score), n3(r.comparison.baseline_score), k.tasks)].join(' '));
    }
    if (e.source === 'skill-placebo') {
      const v = ctx.verdicts.comparisons[e.verdict_key];
      put('Source\'s verdict', TX.R3(slot(ctx.verdictsFile, `comparisons.${e.verdict_key}.verdict`, v.verdict)));
    }
    const ec = r.economics;
    const fig = ec && ec.with_skill && ec.baseline ? [ec.with_skill.mean_input_tokens, ec.with_skill.mean_output_tokens, ec.baseline.mean_input_tokens, ec.baseline.mean_output_tokens] : [null];
    if (fig.some((x) => !num(x))) put('Tokens', TX.T4);
    else {
      const cw = ec.with_skill.mean_cost_usd_per_call; const cb = ec.baseline.mean_cost_usd_per_call;
      const costs = num(cw) && num(cb);
      if (costs && !Object.hasOwn(TX.basis, ec.basis)) refuse(`${f}: economics.basis ${shown(ec.basis)} has no fixed text`);
      put('Tokens', [TX.T1(...fig.map((x) => String(Math.round(x)))), ...(costs ? [TX.T2(cw.toFixed(4), cb.toFixed(4), TX.basis[ec.basis])] : [])].join(' '));
    }
  }
  const fresh = freshnessOf(r, ctx.aliases, verb);
  put('Freshness', fresh.text);
  put('Skill commit', e.skill_commit ? slot(f, 'skill_commit', e.skill_commit) : TX.noCommit);
  const base = path.basename(f);
  const href = e.source === 'driftproof' ? `/r/${r.receipt_hash}/` : `/skills/receipts/${e.source}/${base}`;
  put('Receipt', base, `<a href="${esc(href)}">${esc(base)}</a>`);
  const order = FIELDS.filter((k) => Object.hasOwn(fields, k));
  const pair = k => `<dt>${esc(k === 'by' ? `${verb} by` : k)}</dt><dd>${k === 'by' ? `<h2>${html[k]}</h2>` : html[k]}</dd>`;
  const leading=order.filter(k=>['by','Model','Date','Result','Tasks and runs','Receipt',"Source's verdict"].includes(k));
  const metadata=order.filter(k=>!leading.includes(k));
  const markup = `<article class="skill-row" data-receipt="${esc(f)}" data-source="${esc(e.source)}" data-evidence="${evidence}" data-freshness="${fresh.value}">
<dl>
${leading.map(pair).join('\n')}
</dl>
<details class="receipt-metadata"><summary>Receipt metadata</summary><dl>${metadata.map(pair).join('\n')}</dl></details>
</article>`;
  return { markup, source: e.source, evidence, freshness: fresh.value, label: e.source === 'nvidia' ? TX.NVLABEL : plainOf(r).label, model: fields.Model, hash: r.receipt_hash, file: f, srcName: src.name, date: r.run.date_utc, summary: fields.Result };
}

// ── the page texts ────────────────────────────────────────────────────────────────────────────
const joinNames = (n) => (n.length === 1 ? n[0] : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`);
function attribution(s) {
  if (s.id === 'driftproof') return `<p class="skill-source"><a href="https://github.com/${esc(s.repo)}">Receipts by Driftproof (driftproofhq/driftproof), licensed Apache-2.0.</a></p>`;
  const tree = `https://github.com/${s.repo}/tree/${s.commit}`;
  if (s.id === 'skill-placebo') return `<p class="skill-source"><a href="${esc(tree)}">Trials from ${esc(s.repo)} at commit ${esc(s.commit)},</a> <a href="/skills/receipts/skill-placebo/LICENSE">licensed MIT.</a></p>`;
  return `<p class="skill-source"><a href="${esc(tree)}">Figures from ${esc(s.repo)} at commit ${esc(s.commit)},</a> <a href="${DEED}">licensed CC BY 4.0.</a> Reformatted by Driftproof; NVIDIA does not endorse this page.</p>`;
}
function dispute(title, url, rows) {
  const body = [`Page: ${url}`, '', ...rows.map((x) => `Receipt: ${path.basename(x.file)} (receipt_hash ${x.hash})`), '', 'What do you disagree with, or which run would you like repeated?'].join('\n');
  const q = new URLSearchParams({ labels: 'index', title, body }).toString();
  return `<p class="skill-dispute"><a href="${esc(`${DISPUTE}?${q}`)}">${esc(TX.D1)}</a></p>`;
}
const built = (d) => `<p class="skill-built">Built on <time data-build-date datetime="${d}">${d}</time> from committed receipts.</p>`;
function shell(title, description, main) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="stylesheet" href="/style.css">
</head>
<body>
<main class="skill-index" data-description="${esc(description)}">
${main}
</main>
</body>
</html>
`;
}

// ── the title ladder (spec 267 § Title ladder, TBD-1 (b)) ─────────────────────────────────────
function titles(idents) {
  const count = new Map();
  for (const x of idents) count.set(x.name.toLowerCase(), (count.get(x.name.toLowerCase()) || 0) + 1);
  const out = new Map();
  const seen = new Map();
  for (const x of idents) {
    const unique = count.get(x.name.toLowerCase()) === 1;
    const rungs = unique ? [`${x.name}: worth installing? | Driftproof`, `${x.name} | Driftproof`] : [`${x.name} by ${x.owner}: worth installing? | Driftproof`, `${x.name} by ${x.owner} | Driftproof`];
    const t = rungs.find((r) => r.length <= TITLE_MAX);
    if (!t) refuse(`${x.page}: no title rung fits ${TITLE_MAX} characters (spec 267 § Title ladder; the shortest is ${rungs[rungs.length - 1].length})`);
    if (seen.has(t.toLowerCase())) refuse(`${x.page} and ${seen.get(t.toLowerCase())}: the title ${shown(t)} is not unique`);
    seen.set(t.toLowerCase(), x.page);
    out.set(x.page, t);
  }
  return out;
}

const BUILD_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
function checkBuildDate(d) {
  const m = BUILD_DATE.exec(String(d));
  const t = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
  if (!m || t.toISOString().slice(0, 10) !== d) refuse(`the build date ${shown(d)} is not YYYY-MM-DD naming a real calendar day`);
}

// ── the build ─────────────────────────────────────────────────────────────────────────────────
export function buildSkillIndex({ root = REPO, buildDate } = {}) {
  checkBuildDate(buildDate);
  if (!LEXICON) refuse('spec 031\'s band lexicon (specs/031-artefact-claims/probes/bands.mjs) is not in this tree: the index is built in the source tree');
  root = path.resolve(root);
  const { doc: m } = readJsonAt(root, 'index-receipts/sources.json', 'the index manifest');
  const sources = checkSources(m);
  const aliases = m.model_aliases === undefined ? {} : m.model_aliases;
  checkAliases(aliases);
  // AC-1: each listed file first, in manifest order.
  const receipts = new Map();
  for (const e of m.receipts) receipts.set(e, checkFile(root, e, sources));
  // A file listed twice.
  const files = new Map();
  for (const e of m.receipts) { if (files.has(e.file)) refuse(`${e.file}: the manifest lists it twice`); files.set(e.file, e); }
  // Completeness: every receipt of a listed Driftproof skill in the report folders.
  const dpNames = new Set(m.receipts.filter((e) => e.source === 'driftproof').map((e) => e.name));
  for (const n of REPORTS) {
    for (const f of walkJson(root, `receipts/report-${n}`)) {
      let name = null;
      try { name = JSON.parse(fs.readFileSync(path.join(root, f), 'utf8')).skill.name; } catch { name = null; }
      if (dpNames.has(name) && !files.has(f)) refuse(`${f}: a receipt of ${shown(name)} the manifest does not list`);
    }
  }
  const sp = sources.get('skill-placebo');
  const verdicts = pinnedFile(root, sp, 'verdicts');
  const lockDoc = pinnedFile(root, sp, 'identity_record');
  if (!isObject(verdicts.comparisons)) refuse(`${sp.verdicts.file}: no comparisons`);
  const keys = new Set(m.receipts.filter((e) => e.source === 'skill-placebo').map((e) => e.verdict_key));
  for (const k of Object.keys(verdicts.comparisons).sort(byCodeUnit)) if (!keys.has(k)) refuse(`${sp.verdicts.file}: the comparison ${shown(k)} has no manifest entry`);
  for (const k of keys) if (!isObject(verdicts.comparisons[k]) || typeof verdicts.comparisons[k].verdict !== 'string') refuse(`${sp.verdicts.file}: no verdict for ${shown(k)}`);
  const own = new Set([sp.verdicts.file, sp.identity_record.file]);
  for (const id of ['skill-placebo', 'nvidia']) {
    for (const f of walkJson(root, `index-receipts/${id}`)) if (!own.has(f) && !files.has(f)) refuse(`${f}: a file under index-receipts/${id}/ the manifest does not list`);
  }
  // AC-3: identities from the records.
  if (!Array.isArray(lockDoc.skills)) refuse(`${sp.identity_record.file}: no skills list`);
  const lock = new Map(lockDoc.skills.map((x) => [x && x.id, x]));
  const rec = { driftproof: driftproofRecord(root, sources.get('driftproof')), lockFile: sp.identity_record.file, nvidiaCommit: sources.get('nvidia').commit };
  const r009 = new Map();
  for (const e of m.receipts) if (e.source === 'driftproof' && e.report === '009') r009.set(e.name, receipts.get(e).skill.content_hash);
  const ctx = { sources, aliases, verdicts, verdictsFile: sp.verdicts.file };
  const idents = new Map();
  const entries = [];
  for (const e of m.receipts) {
    const r = receipts.get(e);
    const id = identityOf(e, r, rec, lock);
    if (e.source === 'driftproof') {
      if (!r009.has(e.name)) refuse(`${e.file}: no Report 009 receipt of ${shown(e.name)} is listed to read its skill bytes from`);
      if (r.skill.content_hash !== r009.get(e.name)) refuse(`${e.file}: skill.content_hash is not Report 009's for ${shown(e.name)}`);
    }
    for (const k of ['owner', 'repo', 'path', 'name']) slot(e.file, `identity.${k}`, id[k]);
    const prev = idents.get(id.page.toLowerCase());
    if (prev && (prev.page !== id.page || prev.path !== id.path || prev.unit !== id.unit)) refuse(`${prev.page} and ${id.page}: two identities give one page (${e.file})`);
    if (!prev) idents.set(id.page.toLowerCase(), id);
    entries.push({ e, r, id: idents.get(id.page.toLowerCase()) });
  }
  // AC-9: a skill-placebo reading opposite to its source's verdict holds the whole identity.
  const held = [];
  const heldPages = new Set();
  for (const { e, r, id } of entries) {
    if (e.source !== 'skill-placebo') continue;
    const verdict = verdicts.comparisons[e.verdict_key].verdict;
    const o = opposedToPublished(r, verdict);
    if (o.opposite) {
      heldPages.add(id.page);
      held.push({ identity: id.page, source: e.source, receipt: e.file, reason: `the recomputed direction is ${o.receipt_direction} and the source's verdict is "${verdict}"` });
    }
  }
  held.sort((a, b) => byCodeUnit(a.identity, b.identity) || byCodeUnit(a.receipt, b.receipt));
  const live = entries.filter((x) => !heldPages.has(x.id.page));
  // § Row order: source order, then the run's instant newest first, then the file path.
  live.sort((a, b) => SOURCES.indexOf(a.e.source) - SOURCES.indexOf(b.e.source) || Date.parse(b.r.run.date_utc) - Date.parse(a.r.run.date_utc) || byCodeUnit(a.e.file, b.e.file));
  const pages = new Map();
  for (const x of live) {
    if (!pages.has(x.id.page)) pages.set(x.id.page, { id: x.id, rows: [] });
    pages.get(x.id.page).rows.push(rowOf(x.e, x.r, ctx));
  }
  // Issue 408: the same admission path serves CLI and exported builds.
  let campaign;
  try { campaign = campaignPublication(root); } catch (e) { refuse(e.code || 'CAMPAIGN_REFUSED'); }
  for (const x of campaign.rows) {
    if (heldPages.has(x.id.page)) refuse('CAMPAIGN_HELD_IDENTITY');
    const old = idents.get(x.id.page.toLowerCase());
    if (old && (old.page !== x.id.page || old.path !== x.id.path || old.unit !== x.id.unit)) refuse('CAMPAIGN_IDENTITY_COLLISION');
    if (!pages.has(x.id.page)) pages.set(x.id.page, { id: x.id, rows: [] });
    pages.get(x.id.page).rows.push(x.row);
  }
  for(const p of pages.values())p.rows.sort((a,b)=>SOURCES.indexOf(a.source)-SOURCES.indexOf(b.source)||Date.parse(b.date||'1970-01-01')-Date.parse(a.date||'1970-01-01')||byCodeUnit(a.file,b.file));
  const ordered = [...pages.values()].sort((a, b) => byCodeUnit(`${a.id.page}/index.html`, `${b.id.page}/index.html`));
  const title = titles(ordered.map((p) => p.id));
  const out = [...campaign.files];
  for (const p of ordered) {
    const id = p.id;
    const ids = SOURCES.filter((s) => p.rows.some((x) => x.source === s));
    const verb = verbOf(p.rows.some((x) => x.evidence === 'measured'));
    const ownCampaign=p.rows.some(x=>x.summary?.startsWith('<section'));
    const desc = ownCampaign ? id.name+': '+campaign.description : TX.P1(verb, id.name, id, joinNames(ids.map((s) => sources.get(s).name)));
    if (desc.length > DESC_MAX) refuse(`${id.page}: its description is ${desc.length} characters, over ${DESC_MAX}`);
    const url = `${ORIGIN}/skills/${id.page}/`;
    // Keep the exact scoped description as the first paragraph, inside the native
    // context control before campaign results. Other pages keep P-1 first.
    const context = [
      `<p class="skill-lede">${esc(desc)}</p>`,
      ...(ownCampaign?['<p><a href="/reports/015/">Report 015: '+esc(campaign.title)+'</a></p>']:[]),
      `<p class="skill-where">${esc(G2(verb, id))}</p>`,
      `<p class="skill-note">${esc(TX.G3)}</p>`,
    ];
    const main = [
      ...(ownCampaign?['<div class="scoreboard-eyebrow">'+esc(campaign.title)+'</div>']:[]),
      `<div class="skill-eyebrow">Worth installing?</div><h1>${esc(id.name)}</h1>`,
      ...(ownCampaign?['<div class="skill-intro">Here is what happened when we tested its written answers, with and without the skill.</div>']:context),
      ...(ownCampaign?['<details class="skill-about"><summary>About this test</summary>',...context,'</details>']:[]),
      `<h2>${verb} results</h2>`,
      ...(p.rows.filter(x=>x.summary?.startsWith('<section')).length===2?['<p>Both model sets use Haiku 5.5 as judge.</p>']:[]),
      '<div class="skill-results">',
      ...p.rows.map((x) => x.markup),
      '</div>',
      ...(ownCampaign?[campaign.journey]:[]),
      ...ids.map((s) => attribution(sources.get(s))),
      dispute(`Skill index: ${id.page}`, url, p.rows),
      built(buildDate),
    ].join('\n');
    out.push({ path: `${id.page}/index.html`, bytes: Buffer.from(applyHeadTags(shell(title.get(id.page), desc, main), `skills/${id.page}/index.html`)) });
  }
  // The list page.
  const set = (k, rows) => SETS[k].filter((v) => rows.some((x) => x[k] === v)).join(' ');
  // P-3 opens the page, as its description (spec 020 AC-14). G-6 links the skill lookup (A-267-6); it
  // sits before the filters' mount point, since the filters mount only on a block the list follows
  // directly. The filters' island mounts on the block that holds G-5, its static fallback (spec 020
  // AC-34); the full list follows it, readable with JavaScript off. Each entry carries its identity's
  // path in data-path, which the lookup matches a pasted link against (A-267-6, spec 315 AC-4).
  const listMain = [
    ...(campaign.table?['<section class="scoreboard-hero"><div class="scoreboard-intro"><div class="scoreboard-eyebrow">'+esc(campaign.title)+'</div><h1>Do popular AI skills help?</h1>']:['<h1>'+esc(TX.G4)+'</h1>']),
    `<p class="skill-lede">${esc(TX.P3)}</p>`,
    ...(campaign.table?['<a class="scoreboard-button" href="#measured-comparison">Explore all measured skills</a><p class="scoreboard-source">Driftproof wrote the tasks. Haiku 5.5 judged the answers. The eval account was checked before and after each run, not during it.</p></div><div class="scoreboard-paper"><p class="scoreboard-eyebrow">What happened in the text tests?</p><h2>Same skills. Two answering models.</h2>',campaign.overview,'</div></section>']:[]),
    `<p class="skill-lookup-link">${esc(TX.G6[0])}<a href="/skill-lookup/">${esc(TX.G6[1])}</a>${esc(TX.G6[2])}</p>`,
    ...(campaign.table?['<nav class="measurement-jumps" aria-label="Skill index sections"><a href="#measured-comparison">Measured skills</a><a href="#how-we-test">How we test</a><a href="#all-skills">Browse all skills</a><a href="/reports/015/">Read the report</a></nav>',campaign.table,campaign.journey,campaign.history]:[]),
    ...(campaign.table?['<h2 id="all-skills">Browse all skills</h2>']:[]),
    `<div class="skill-filter" data-island="skill-filter"><p>${esc(TX.G5)}</p></div>`,
    '<ul class="skill-list">',
    ...ordered.map((p) => `<li class="skill-entry" data-page="${esc(p.id.page)}/" data-source="${set('source', p.rows)}" data-evidence="${set('evidence', p.rows)}" data-freshness="${set('freshness', p.rows)}" data-path="${esc(p.id.path)}"><a class="skill-name" href="/skills/${esc(p.id.page)}/">${esc(p.id.name)}</a> <span class="skill-repository">${esc(p.id.owner+'/'+p.id.repo)}${p.id.unit==='plugin'?' (plugin bundle)':''}</span> ${p.rows.map((x) => x.summary?.startsWith('<section') ? `<div class="skill-entry-row"><p class="model-identity">${esc(x.summaryLead)}</p>${x.summary}</div>` : `<span class="skill-entry-row">${esc(TX.L1(x.srcName, x.model, x.label))} ${esc(x.summary)}</span>`).join(' ')}</li>`),
    '</ul>',
    ...SOURCES.map((s) => attribution(sources.get(s))),
    dispute('Skill index', `${ORIGIN}/skills/`, []),
    built(buildDate),
  ].join('\n');
  out.push({ path: 'index.html', bytes: Buffer.from(applyHeadTags(shell(TX.P2, TX.P3, listMain), 'skills/index.html')) });
  // The copies the imported rows link to, and the two licences.
  for (const x of live) if (x.e.source !== 'driftproof') out.push({ path: `receipts/${x.e.source}/${path.basename(x.e.file)}`, bytes: fs.readFileSync(path.join(root, x.e.file)) });
  for (const s of ['skill-placebo', 'nvidia']) out.push({ path: `receipts/${s}/LICENSE`, bytes: readBytes(root, sources.get(s).licence_file, `${s}'s licence`) });
  const names = new Set();
  for (const x of out) { if (names.has(x.path)) refuse(`${x.path}: two files would be written at one path`); names.add(x.path); }
  out.sort((a, b) => byCodeUnit(a.path, b.path));
  return { files: out, held };
}

// ── the CLI ───────────────────────────────────────────────────────────────────────────────────
function walkAll(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walkAll(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}
// A folder a removed page leaves empty goes with it, so --out holds the built tree and nothing else.
function pruneEmpty(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const d = path.join(dir, e.name);
    pruneEmpty(d);
    if (!fs.readdirSync(d).length) fs.rmdirSync(d);
  }
}
function main(argv) {
  const opts = { root: REPO, out: null, buildDate: null, check: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') opts.check = true;
    else if (['--root', '--out', '--build-date'].includes(a)) {
      if (i + 1 >= argv.length) { process.stderr.write(`${a} needs a value\n`); return 2; }
      opts[{ '--root': 'root', '--out': 'out', '--build-date': 'buildDate' }[a]] = argv[++i];
    } else { process.stderr.write(`build-skill-index: unknown argument ${shown(a)}\nusage: node scripts/build-skill-index.mjs [--root DIR] [--out DIR] [--build-date YYYY-MM-DD] [--check]\n`); return 2; }
  }
  const root = path.resolve(opts.root);
  const out = path.resolve(opts.out || path.join(root, 'docs', 'skills'));
  let buildDate = opts.buildDate;
  if (opts.check && buildDate === null) {
    const list = path.join(out, 'index.html');
    const d = fs.existsSync(list) ? /<time data-build-date datetime="(\d{4}-\d{2}-\d{2})">/.exec(fs.readFileSync(list, 'utf8')) : null;
    if (!d) { process.stderr.write(`STALE: ${rel(root, list)} carries no build date to check against\n`); return 1; }
    buildDate = d[1];
  }
  if (buildDate === null) { process.stderr.write('--build-date YYYY-MM-DD is required\n'); return 2; }
  let r;
  try { r = buildSkillIndex({ root, buildDate }); } catch (e) {
    if (!(e instanceof SkillIndexRefused)) throw e;
    process.stderr.write(`build-skill-index refused, nothing written: ${e.message}\n`);
    return 1;
  }
  for (const h of r.held) process.stdout.write(`held: ${h.identity} (${h.source}): ${h.reason}\n`);
  const want = new Map(r.files.map((f) => [f.path, f.bytes]));
  const have = walkAll(out).map((f) => path.relative(out, f).split(path.sep).join('/')).sort(byCodeUnit);
  if (opts.check) {
    const bad = [...want.keys()].find((p) => !fs.existsSync(path.join(out, p)) || !fs.readFileSync(path.join(out, p)).equals(want.get(p)))
      || have.find((p) => !want.has(p));
    if (bad) { process.stderr.write(`STALE against the committed receipts: ${bad} - run: node scripts/build-skill-index.mjs --build-date ${buildDate}\n`); return 1; }
    process.stdout.write(`docs/skills matches the committed receipts: ${r.files.filter((f) => f.path.endsWith('.html')).length} page(s), ${r.held.length} held, built ${buildDate}\n`);
    return 0;
  }
  for (const p of have) if (!want.has(p)) fs.rmSync(path.join(out, p));
  pruneEmpty(out);
  for (const [p, b] of want) {
    const f = path.join(out, p);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    if (!fs.existsSync(f) || !fs.readFileSync(f).equals(b)) fs.writeFileSync(f, b);
  }
  process.stdout.write(`docs/skills: ${r.files.filter((f) => f.path.endsWith('.html')).length} page(s), ${r.files.length} file(s), ${r.held.length} held, built ${buildDate}\n`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
