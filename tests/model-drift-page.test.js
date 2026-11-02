// SPDX-License-Identifier: Apache-2.0
'use strict';
// Issue 639 (specs/639-model-drift-page): the same skill on different models. The checker below is an
// oracle of its own: it walks receipts/ itself, reads docs/data/reports.json, the report pages and the
// committed skill texts itself, and rebuilds each row's text from the receipts, so it never asks the
// page builder what the page should say. Every plant turns it RED for its own criterion. Nothing here
// writes inside the tree.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { plainOf, LABELS, KEY, LEDE_ORDER } = require('../lib/plain');
const { receiptVerdict, verdictFakeToolCallWarning, UNDERPOWERED_LINE, CASES_LINE } = require('../lib/verdict');
const { sealReceipt } = require('../lib/receipt');
const { sha256Files } = require('../lib/canonical');
const policy = require('../lib/report-015-publication');
const { humanModelName } = require('../scripts/model-names');
const { htmlToText } = require('../scripts/html-text.js');

const ROOT = path.resolve(__dirname, '..');
const REL = 'across-models/index.html';
const URL_PATH = '/across-models/';
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const clone = (x) => JSON.parse(JSON.stringify(x));
const and = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const lexicon = import(pathToFileURL(path.join(ROOT, 'specs/031-artefact-claims/probes/bands.mjs')).href).then((m) => m.LEXICON);
const builder = () => require('../scripts/model-drift-page.js');
const { subjectName, pageLabel } = require('../scripts/build-receipt-pages.js');

// ── the page texts, the spec's own copy (§ Page texts) ────────────────────────────────────────────
const T = {
  title: 'The same skill on different models | Driftproof',
  h1: 'The same skill on different models',
  lede: 'Driftproof measured some skills and instruction files on more than one model. Here is what each receipt read, model by model, linked to the receipt.',
  meaning: '“Clearly helped” means the answers with the skill scored clearly higher on at least one test task, and clearly lower on none. “Clearly hurt” means they scored clearly lower on at least one test task, even if another task scored clearly higher. “Too few answers to tell” means there were too few answers, or they varied too much, to call it either way; it does not mean the skill does nothing. A skill that helped on one model is not a guarantee that it helps on another.',
  caution: 'Readings of one text on one model can differ between runs, so two different readings on two models do not show that the model made the difference.',
  how: [
    "A receipt is the record of one test run, with the skill and without it, sealed so that a changed file no longer matches its seal. Each reading is one receipt's, and links to that receipt's page. Where one model has more than one receipt, each is listed on its own. Nothing here is combined, averaged or ranked.",
    'The first list holds each skill or file with a reading that carries a verdict on at least two models. The second list holds each one measured on two or more models without that: each row there has a verdict on at most one model, and each receipt page without a verdict says why. Here a verdict is any reading from Clearly helped to Too few test tasks to tell. Skills and files measured on only one model are not listed.',
    'Each row in the first list says whether its receipts record the same test tasks, the same judge and grading, and the same run setup, and names any receipt that does not. The test tasks are what each answer was asked to do. The judge and grading are the model that scored the answers, its instructions and the code that ran it; the judge counts as different when it is the model that answered in some receipts and not in others. The run setup is the versions of the tools that ran the test, how the skill was given to the model, and how many answers each task asked for.',
    'An instruction file is named by the repository it came from, then its file name. Where a row includes models from more than one maker, it compares no makers: as Report 002 says, it is not a model ranking.',
    'The key at the end of this page gives the exact rule for each reading.',
  ],
  main: 'Skills and files with a verdict on two or more models',
  other: 'Measured on two or more models, without a verdict on two',
  key: 'What each reading means',
  version: (r) => `Driftproof measured more than one version of this text. This row is the version in ${r}.`,
  handoff: 'This text only tells the model to call another skill with the Skill tool, so its receipts read that instruction, not the skill it names.',
  alone: 'These receipts were not all measured the same way, so read each one on its own.',
  noun: { tasks: 'test tasks', grading: 'judge and grading', setup: 'run setup' },
  differs: { tasks: 'different test tasks', setup: 'a different run setup' },
  scored: {
    self: ['was scored by the same model that answered it', 'were scored by the same model that answered them'],
    model: ['was scored by a different model', 'were scored by a different model'],
    other: ['records different grading instructions or settings', 'record different grading instructions or settings'],
    code: ['was scored by a different version of the scoring code', 'were scored by a different version of the scoring code'],
  },
  draws: 'Here a case is a test task, a draw is one answer, and the effect floor is the smallest gap the rule counts.',
  sheet: "Here the sheet is the receipt's own page, which each reading links to.",
  answeredBy: 'Here answered_by is the part of a newer receipt that records what gave the answers.',
  router: 'Here a router is a skill that mostly hands the task to other skills.',
};
const BANNED_PHRASES = /\bnew model|\bstill help|\bbroke\b|\bbreak\b/i;
const BANNED_WORDS = /\bnew\b|\bstill\b/i;

test('AC-10 the meaning sentences and the verdict gloss carry the library labels verbatim', () => {
  for (const s of ['PASSED', 'REGRESSED', 'UNDERPOWERED']) assert.ok(T.meaning.includes(`“${LABELS[s]}”`), s);
  assert.ok(T.how[1].includes(`from ${LABELS.PASSED} to ${LABELS.UNDERPOWERED_CASES}.`));
});

// ── the independent oracle ────────────────────────────────────────────────────────────────────────
// Published receipts, by spec 036's rule.
function publishedReceipts() {
  const out = new Map();
  const rank = (rel) => (rel.includes('/skill-measurements/published/') ? 0 : 1);
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!/-draft$/.test(e.name)) walk(p); continue; }
      if (!e.name.endsWith('.json') || e.name.startsWith('_')) continue;
      let j; try { j = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { continue; }
      if (!j || !j.results || !j.receipt_hash) continue;
      const rel = path.relative(ROOT, p).split(path.sep).join('/');
      const old = out.get(j.receipt_hash);
      if (!old || rank(rel) < rank(old.rel) || (rank(rel) === rank(old.rel) && rel < old.rel)) out.set(j.receipt_hash, { rel, receipt: j });
    }
  })(path.join(ROOT, 'receipts'));
  return [...out.values()];
}
let byHash;
function reportsOfArchive(receipt) {
  if (!byHash) {
    byHash = new Map();
    for (const r of JSON.parse(read('docs/data/reports.json')).reports) for (const p of r.receipt_paths || []) {
      let j; try { j = JSON.parse(read(p.value)); } catch { continue; }
      if (!byHash.has(j.receipt_hash)) byHash.set(j.receipt_hash, new Set());
      byHash.get(j.receipt_hash).add(r.number.value);
    }
  }
  return [...(byHash.get(receipt.receipt_hash) || [])];
}
const BLOCKS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'section', 'div', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'br', 'table', 'tr', 'td', 'th', 'header', 'footer', 'nav', 'details', 'summary'];
const decode = (s) => s.replace(/&(amp|lt|gt|quot|#39|#x27|rsquo|ldquo|rdquo|middot);/g, (m, k) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", '#x27': "'", rsquo: '’', ldquo: '“', rdquo: '”', middot: '·' })[k]);
// Issue 661: read by the tokenizer, never a tag-stripping pattern (CodeQL js/incomplete-multi-character-
// sanitization): a block tag leaves a space, any other tag nothing, each entity decoded once after the tags are gone.
const textOf = (h) => htmlToText(h, { blockTags: BLOCKS, decode, collapse: true });
// A report page's dated note under its headline.
function noteOfReport(n) {
  const f = path.join(ROOT, 'docs/reports', n, 'index.html');
  if (!fs.existsSync(f)) return null;
  const m = /<p\b[^>]*\bid="interim-note"[^>]*>([\s\S]*?)<\/p>/.exec(fs.readFileSync(f, 'utf8'));
  return m ? textOf(m[1]) : null;
}
// The committed skill texts, by the content hash a receipt seals for them, and the hand-off rule.
function textsOracle() {
  const out = new Map();
  for (const d of ['receipts/report-017-panel', 'specs/639-model-drift-page/texts']) {
    if (!fs.existsSync(path.join(ROOT, d))) continue;
    for (const f of fs.readdirSync(path.join(ROOT, d)).filter((n) => n.endsWith('.md'))) {
      const bytes = fs.readFileSync(path.join(ROOT, d, f));
      out.set(sha256Files([{ path: 'SKILL.md', bytes }]), bytes.toString('utf8'));
    }
  }
  return out;
}
const handoffOracle = (t) => { const lines = t.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean); return lines.length > 0 && lines.every((l) => l.startsWith('Call the Skill tool')); };

const reportsText = (ns) => (ns.length === 1 ? `Report ${ns[0]}` : `Reports ${and(ns)}`);
function placeOf(x, reportsOf) {
  const ns = [...new Set(reportsOf(x.receipt))].sort();
  const run = /\/run-(\d+)\//.exec(x.rel);
  const word = /^receipts\/report-\d+-([a-z]+)\//.exec(x.rel);
  return reportsText(ns) + (run ? `, run ${run[1]}` : word ? `, ${word[1]}` : '');
}
const wordsOf = (r) => { if (policy.routerLimit(r)) return 'ROUTER'; if (verdictFakeToolCallWarning(r)) return 'UNRELIABLE'; const p = plainOf(r); return p.words || p.state; };
const readingOf = (r) => (policy.routerLimit(r) ? policy.LABEL : plainOf(r).label);
// From "Clearly helped" to "Too few test tasks to tell", the range the verdict gloss names.
const VERDICT = ['PASSED', 'REGRESSED', 'NO_EFFECT', 'UNDERPOWERED', 'UNDERPOWERED_CASES'];

// AC-8's three groups, as the spec's table gives them.
const get = (o, p) => p.split('.').reduce((v, k) => (v === undefined || v === null ? undefined : v[k]), o);
const none = (v) => v === undefined || v === null;
const nul = (v) => (v === undefined ? null : v);
const arms = (r) => ((r.results || {}).cases || []).filter((c) => c.mode === 'with_skill' || c.mode === 'baseline');
const canon = (id) => String(id || '').replace(/-\d{8}$/, '');
function fields(r, g) {
  const rows = arms(r);
  if (g === 'tasks') return { req: [get(r, 'suite.suite_hash')], eq: [get(r, 'run.scope.task_ids'), get(r, 'run.scoring.freeze_hash')], where: rows.filter((c) => get(c, 'generation.suite_case')).map((c) => [c.id, c.mode, nul(get(c, 'generation.suite_case.prompt_hash')), nul(get(c, 'generation.suite_case.grading_hash'))]) };
  if (g === 'grading') {
    const judges = rows.map((c) => get(c, 'judge.model_id') ?? get(r, 'run.judge.model_id'));
    const ok = rows.length > 0 && judges.every((j) => !none(j));
    const sealed = get(r, 'run.judge.relationship');
    const self = !ok ? null : sealed && sealed.comparison_scope === 'within-model' && typeof sealed.same_model === 'boolean' ? sealed.same_model : judges.some((j) => canon(j) === canon(r.run.model_id));
    return { req: [ok ? 1 : null, get(r, 'run.judge.prompt_template_hash'), get(r, 'run.judge.samples'), get(r, 'run.judge.surface'), ...rows.map((c) => get(c, 'judge.rubric_hash'))],
      eq: [get(r, 'run.judge.temperature'), get(r, 'run.judge.sampling'), get(r, 'run.judge.code_revision'), self, [...new Set(rows.map((c, i) => `${c.id}|${c.mode}|${judges[i]}|${get(c, 'judge.rubric_hash')}`))].sort()], where: [] };
  }
  return { req: [get(r, 'run.runner_version'), get(r, 'run.surface')], eq: [...['delivery', 'harness', 'judge.harness', 'capture.mode', 'capture.limits', 'timeout_ms', 'answered_by.kind', 'provider'].map((k) => get(r, `run.${k}`)), [...new Set(rows.map((c) => `${c.id}|${c.mode}|${get(c, 'generation.n_planned')}`))].sort()], where: [] };
}
function across(xs, g) {
  const f = xs.map((x) => ({ x, f: fields(x.receipt, g) }));
  const missing = f.filter((e) => e.f.req.some(none)).map((e) => e.x);
  const rec = f.filter((e) => !e.f.req.some(none));
  // Two receipts are alike when required and equal fields match, and where-present fields match
  // wherever both record them. Classes are built in row order.
  const key = (e) => JSON.stringify([e.f.req.map(nul), e.f.eq.map(nul)]);
  const classes = [];
  for (const e of rec) {
    const home = classes.find((c) => c.every((o) => key(o) === key(e) && (!o.f.where.length || !e.f.where.length || JSON.stringify(o.f.where) === JSON.stringify(e.f.where))));
    if (home) home.push(e); else classes.push([e]);
  }
  let differ = [], ref = null;
  if (classes.length > 1) {
    const big = [...classes].sort((a, b) => b.length - a.length || xs.indexOf(a[0].x) - xs.indexOf(b[0].x))[0];
    ref = big[0].x;
    differ = xs.filter((x) => rec.some((e) => e.x === x) && !big.some((e) => e.x === x));
  }
  return { state: missing.length ? 'unrecorded' : differ.length ? 'differ' : 'same', missing, differ, ref };
}
// The field a grading difference is in, against the reference receipt: self-scored where the
// reference is not; another judge model; only the scoring code; anything else.
function kindOf(x, ref) {
  const parts = (r) => {
    const rows = arms(r), judges = rows.map((c) => get(c, 'judge.model_id') ?? get(r, 'run.judge.model_id'));
    const sealed = get(r, 'run.judge.relationship');
    return {
      models: [...new Set(judges)].sort().join(','),
      self: sealed && sealed.comparison_scope === 'within-model' && typeof sealed.same_model === 'boolean' ? sealed.same_model : judges.some((j) => canon(j) === canon(r.run.model_id)),
      code: nul(get(r, 'run.judge.code_revision')),
      rest: JSON.stringify([...['prompt_template_hash', 'samples', 'surface', 'temperature', 'sampling'].map((k) => nul(get(r, `run.judge.${k}`))), rows.map((c) => `${c.id}|${c.mode}|${get(c, 'judge.rubric_hash')}`).sort()]),
    };
  };
  const a = parts(x.receipt), b = parts(ref.receipt);
  return a.self && !b.self ? 'self' : a.models !== b.models ? 'model' : a.rest === b.rest && a.code !== b.code ? 'code' : 'other';
}
function whoText(row, named) {
  const noun = named.length === 1 ? 'receipt' : 'receipts';
  const reps = [...new Set(named.flatMap((x) => row.rep.get(x)))].sort();
  if (row.xs.filter((x) => row.rep.get(x).some((n) => reps.includes(n))).every((x) => named.includes(x))) return `${noun} from ${reportsText(reps)}`;
  const items = [];
  for (const p of [...new Set(named.map((x) => row.place.get(x)))]) {
    const all = row.xs.filter((x) => row.place.get(x) === p), here = named.filter((x) => row.place.get(x) === p);
    if (all.length === here.length) items.push(p); else for (const x of here) items.push(`${p} on ${humanModelName(x.receipt.run.model_id)}`);
  }
  return `${noun} from ${items.length > 1 ? `${items.slice(0, -1).join('; ')}; and ${items[items.length - 1]}` : items[0]}`;
}
function conditionsText(row) {
  const out = [];
  for (const g of ['tasks', 'grading', 'setup']) {
    const a = row.groups[g];
    if (a.state === 'same') { out.push(`Every receipt in this row records the same ${T.noun[g]}.`); continue; }
    if (a.missing.length) out.push(`Not every receipt records its ${T.noun[g]}: the ${whoText(row, a.missing)} ${a.missing.length === 1 ? 'does' : 'do'} not.`);
    if (a.differ.length && g !== 'grading') out.push(`The ${whoText(row, a.differ)} ${a.differ.length === 1 ? 'records' : 'record'} ${T.differs[g]}.`);
    if (a.differ.length && g === 'grading') {
      for (const k of ['self', 'model', 'other', 'code']) {
        const these = a.differ.filter((x) => kindOf(x, a.ref) === k);
        if (these.length) out.push(`The ${whoText(row, these)} ${T.scored[k][these.length === 1 ? 0 : 1]}.`);
      }
    }
  }
  if (Object.values(row.groups).some((a) => a.state !== 'same')) out.push(T.alone);
  return out.join(' ');
}

function expectedRows(entries, { reportsOf, texts = textsOracle(), notes = noteOfReport }) {
  const by = new Map();
  for (const x of entries) { const k = x.receipt.skill.content_hash; if (!by.has(k)) by.set(k, []); by.get(k).push(x); }
  const rows = [];
  for (const [subject, xs0] of by) {
    const ids = [...new Set(xs0.map((x) => x.receipt.run.model_id))];
    if (ids.length < 2) continue;
    const xs = [...xs0].sort((a, b) => cmp(a.receipt.run.date_utc, b.receipt.run.date_utc) || cmp(a.rel, b.rel));
    const models = ids.map((id) => ({ id, list: xs.filter((x) => x.receipt.run.model_id === id) }))
      .sort((a, b) => cmp(a.list[0].receipt.run.date_utc, b.list[0].receipt.run.date_utc) || cmp(a.id, b.id));
    const verdicts = models.filter((m) => m.list.some((x) => VERDICT.includes(wordsOf(x.receipt)))).length;
    const rep = new Map(xs.map((x) => [x, [...new Set(reportsOf(x.receipt))].sort()]));
    const place = new Map(xs.map((x) => [x, placeOf(x, reportsOf)]));
    const row = { subject, name: subjectName(xs[0].rel, xs[0].receipt), xs, models, rep, place, first: xs[0].receipt.run.date_utc, list: verdicts >= 2 ? 'main' : 'other' };
    row.groups = Object.fromEntries(['tasks', 'grading', 'setup'].map((g) => [g, across(xs, g)]));
    row.conditions = Object.fromEntries(Object.entries(row.groups).map(([g, a]) => [g, a.state]));
    row.router = xs.some((x) => policy.routerLimit(x.receipt));
    row.handoff = texts.has(subject) && handoffOracle(texts.get(subject));
    row.reports = [...new Set(xs.flatMap((x) => rep.get(x)))].sort();
    const byNote = new Map();
    for (const n of row.reports) { const t = notes(n); if (t) { if (!byNote.has(t)) byNote.set(t, []); byNote.get(t).push(n); } }
    // Led in by its own report, the others named after it.
    row.notes = [...byNote].map(([text, ns]) => `Report ${ns[0]}'s note, on its own page: “${text}”${ns.length === 1 ? '' : ns.length === 2 ? ` Report ${ns[1]} carries the same note on its page.` : ` ${and(ns.slice(1).map((n) => `Report ${n}`))} carry the same note on theirs.`}`);
    rows.push(row);
  }
  rows.sort((a, b) => cmp(a.list === 'main' ? 0 : 1, b.list === 'main' ? 0 : 1) || cmp(a.name.toLowerCase(), b.name.toLowerCase()) || cmp(a.first, b.first) || cmp(a.subject, b.subject));
  const count = new Map();
  for (const r of rows) count.set(r.name, (count.get(r.name) || 0) + 1);
  for (const r of rows) {
    r.versioned = count.get(r.name) > 1;
    const parts = [r.name];
    if (r.list === 'main') { r.conditionsText = conditionsText(r); parts.push(r.conditionsText); }
    if (r.router) parts.push(`${policy.REASON} Report 015 Amendment 1.`);
    if (r.versioned) parts.push(T.version(reportsText(r.reports)));
    if (r.handoff) parts.push(T.handoff);
    for (const m of r.models) parts.push(`On ${humanModelName(m.id)}: ${m.list.map((x) => `${readingOf(x.receipt)} (${r.place.get(x)}, ${String(x.receipt.run.date_utc).slice(0, 10)})`).join('; ')}.`);
    parts.push(...r.notes);
    r.text = parts.join(' ');
  }
  return rows;
}

// The key: one entry per reading shown. `look` lets a test hand in the readings of a receipt the
// archive has none of (a "Comparison unreliable" receipt, issue 613).
function keyEntry(s, receipts, look = {}) {
  const warning = look.warning || verdictFakeToolCallWarning;
  const label = look.label || ((r) => plainOf(r).label);
  if (s === 'ROUTER') return `${policy.LABEL}: ${policy.REASON} Report 015 Amendment 1. Its receipt page calls it “${[...new Set(receipts.map((r) => policy.routerLimit(r).label))].join('” or “')}”. ${T.router}`;
  const page = [...new Set(receipts.map((r) => (look.pageLabel || ((x) => pageLabel(receiptVerdict(x))))(r)))];
  if (s === 'UNRELIABLE') return `${label(receipts[0])}: ${String(warning(receipts[0])).replace(/^Comparison unreliable: /, '')} Its receipt page calls it “${page.join('” or “')}”.`;
  const adds = s === 'UNDERPOWERED' ? ` That page adds: ${UNDERPOWERED_LINE}. ${T.draws}` : s === 'UNDERPOWERED_CASES' ? ` That page adds: ${CASES_LINE}. ${T.draws}` : ['NOT_MEASURED', 'PRE_ANSWERED_BY', 'REFUSED'].includes(s) ? ` ${T.sheet}${s === 'PRE_ANSWERED_BY' ? ` ${T.answeredBy}` : ''}` : '';
  return `${LABELS[s]}: ${KEY[s]} Its receipt page calls it “${page.join('” or “')}”.${adds}`;
}
const keyOrder = (shown) => [...LEDE_ORDER.filter((s) => shown.has(s)), ...['UNRELIABLE', 'ROUTER'].filter((s) => shown.has(s))];
function keyExpected(rows) {
  const shown = new Map();
  for (const r of rows) for (const x of r.xs) { const w = wordsOf(x.receipt); if (!shown.has(w)) shown.set(w, []); shown.get(w).push(x.receipt); }
  return keyOrder(shown).map((s) => ({ s, text: keyEntry(s, shown.get(s)) }));
}

// ── reading the page ──────────────────────────────────────────────────────────────────────────────
const attrs = (s) => Object.fromEntries([...s.matchAll(/\bdata-([a-z-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
const mainOf = (html) => { const m = /<main\b[^>]*>([\s\S]*?)<\/main>/.exec(html); return m ? m[1] : null; };
const READING = /<span class="drift-reading" data-receipt="([^"]*)"><a href="([^"]*)">([\s\S]*?)<\/a> \(<span data-place>([^<]*)<\/span>, <span data-date>([^<]*)<\/span>\)<\/span>/g;

// Every problem the page has against the receipts, each tagged with the criterion it breaks.
async function checkPage(html, { entries, reportsOf, pages = true, texts, notes }) {
  const P = [];
  const main = mainOf(html);
  if (main === null) return ['AC-12 no <main>'];
  const exp = expectedRows(entries, { reportsOf, ...(texts ? { texts } : {}), ...(notes ? { notes } : {}) });
  const entryOf = new Map(entries.map((x) => [x.receipt.receipt_hash, x]));
  const got = [...main.matchAll(/<section class="drift-row"([^>]*)>([\s\S]*?)<\/section>/g)].map((m) => ({ a: attrs(m[1]), body: m[2] }));
  // AC-1: the rows, their lists, and every reading once.
  const want = new Set(exp.map((r) => r.subject));
  for (const g of got) if (!want.has(g.a.subject)) P.push(`AC-1 extra row ${String(g.a.subject).slice(0, 12)}`);
  for (const s of want) if (!got.some((g) => g.a.subject === s)) P.push(`AC-1 missing row ${s.slice(0, 12)}`);
  const seen = new Map();
  for (const g of got) for (const m of g.body.matchAll(/<span class="drift-reading" data-receipt="([^"]*)">/g)) seen.set(m[1], (seen.get(m[1]) || 0) + 1);
  for (const r of exp) for (const x of r.xs) { const n = seen.get(x.receipt.receipt_hash) || 0; if (n !== 1) P.push(`AC-1 reading ${x.receipt.receipt_hash.slice(0, 12)} appears ${n} times`); }
  for (const h of seen.keys()) if (!exp.some((r) => r.xs.some((x) => x.receipt.receipt_hash === h))) P.push(`AC-1 reading of a receipt outside the rows ${h.slice(0, 12)}`);
  // AC-9: the order of rows.
  const order = got.map((g) => g.a.subject).filter((s) => want.has(s));
  if (JSON.stringify(order) !== JSON.stringify(exp.map((r) => r.subject).filter((s) => order.includes(s)))) P.push('AC-9 rows out of order');
  // The two list headings frame the two lists.
  const iMain = main.indexOf(`<h2>${T.main}</h2>`), iOther = main.indexOf(`<h2>${T.other}</h2>`), iKey = main.indexOf(`<h2 id="key">${T.key}</h2>`);
  if (iMain < 0 || iOther < iMain || iKey < iOther) P.push('AC-10 headings');
  for (const m of main.matchAll(/<section class="drift-row" data-list="([^"]*)"/g)) {
    const inMain = m.index > iMain && m.index < iOther;
    if ((m[1] === 'main') !== inMain) P.push('AC-1 a row sits under the other list\'s heading');
  }
  for (const g of got) {
    const e = exp.find((r) => r.subject === g.a.subject);
    if (!e) continue;
    if (g.a.list !== e.list) P.push(`AC-1 ${e.name} is in list ${g.a.list}, receipts give ${e.list}`);
    for (const m of g.body.matchAll(/data-receipt="([^"]*)"/g)) { const x = entryOf.get(m[1]); if (!x || x.receipt.skill.content_hash !== e.subject) P.push(`AC-2 reading ${m[1].slice(0, 12)} is not this row's text`); }
    // AC-8: the three groups, directly under the heading, and the receipts they name.
    if (e.list === 'main') {
      for (const k of ['tasks', 'grading', 'setup']) if (g.a[k] !== e.conditions[k]) P.push(`AC-8 ${k} reads ${g.a[k]}, receipts give ${e.conditions[k]}`);
      const c = /^\s*<h3 data-subject-name>[\s\S]*?<\/h3>\s*<p class="drift-conditions">([\s\S]*?)<\/p>/.exec(g.body);
      if (!c || textOf(c[1]) !== e.conditionsText) P.push(`AC-8 conditions of ${e.name}: ${c ? JSON.stringify(textOf(c[1]).slice(0, 160)) : 'not under the heading'}`);
    } else if (/drift-conditions/.test(g.body) || g.a.tasks) P.push(`AC-8 a second-list row carries conditions`);
    // AC-4, AC-15, AC-16: the lines a row needs.
    if (e.router && !(g.body.includes(`<p class="drift-router">${policy.REASON} <a href="${policy.AMENDMENT}">`))) P.push(`AC-4 router row ${e.name} has no REASON line`);
    for (const n of e.notes) if (!textOf(g.body).includes(n)) P.push(`AC-15 ${e.name} lacks the note: ${n.slice(0, 40)}`);
    if (e.notes.length !== [...g.body.matchAll(/<p class="drift-note">/g)].length) P.push(`AC-15 ${e.name} carries ${[...g.body.matchAll(/<p class="drift-note">/g)].length} notes`);
    if (e.handoff !== g.body.includes(`<p class="drift-handoff">${T.handoff}</p>`)) P.push(`AC-16 hand-off note for ${e.name}`);
    // AC-7: each model paragraph holds that model's readings and names it; each place and date.
    for (const m of g.body.matchAll(/<p class="drift-model" data-model="([^"]*)">([\s\S]*?)<\/p>/g)) {
      const name = /<span data-model-name>([\s\S]*?)<\/span>/.exec(m[2]);
      let human = null; try { human = humanModelName(m[1]); } catch { human = null; }
      if (!name || textOf(name[1]) !== human) P.push(`AC-7 model name for ${m[1]}`);
      for (const h of m[2].matchAll(/data-receipt="([^"]*)"/g)) { const x = entryOf.get(h[1]); if (!x || x.receipt.run.model_id !== m[1]) P.push(`AC-7 reading ${h[1].slice(0, 12)} filed under ${m[1]}`); }
    }
    let readings = 0;
    for (const m of g.body.matchAll(READING)) {
      readings++;
      const x = entryOf.get(m[1]);
      if (!x) continue;
      const label = textOf(m[3]);
      if (policy.routerLimit(x.receipt) && label !== policy.LABEL) P.push(`AC-4 router ${m[1].slice(0, 12)} reads ${label}`);
      else if (label !== readingOf(x.receipt)) P.push(`AC-3 ${m[1].slice(0, 12)} reads ${label}`);
      if (m[2] !== `/r/${m[1]}/`) P.push(`AC-6 ${m[1].slice(0, 12)} links ${m[2]}`);
      if (pages) { const f = path.join(ROOT, 'docs', m[2], 'index.html'); if (!fs.existsSync(f) || !fs.readFileSync(f, 'utf8').includes(m[1])) P.push(`AC-6 ${m[2]} is not that receipt's page`); }
      if (e.xs.includes(x) && textOf(m[4]) !== e.place.get(x)) P.push(`AC-7 ${m[1].slice(0, 12)} place ${textOf(m[4])}`);
      if (m[5] !== String(x.receipt.run.date_utc).slice(0, 10)) P.push(`AC-7 ${m[1].slice(0, 12)} date ${m[5]}`);
    }
    if (readings !== [...g.body.matchAll(/class="drift-reading"/g)].length) P.push(`AC-7 a reading in ${e.name} is not in the reading form`);
    const head = /<h3 data-subject-name>([\s\S]*?)<\/h3>/.exec(g.body);
    if (!head || textOf(head[1]) !== e.name) P.push(`AC-2 row name for ${e.subject.slice(0, 12)}`);
    if (e.versioned !== /<p class="drift-version">/.test(g.body)) P.push(`AC-2 version note for ${e.subject.slice(0, 12)}`);
    if (textOf(g.body) !== e.text) P.push(`AC-9 row text for ${e.name} (${e.subject.slice(0, 12)}): ${JSON.stringify(textOf(g.body).slice(0, 160))}`);
  }
  const notes2 = got.map((g) => textOf((/<h3 data-subject-name>([\s\S]*?)<\/h3>/.exec(g.body) || ['', ''])[1]) + '|' + textOf((/<p class="drift-version">([\s\S]*?)<\/p>/.exec(g.body) || ['', ''])[1]));
  if (new Set(notes2).size !== notes2.length) P.push('AC-2 two rows read the same');
  // AC-10: the top and the key.
  const h1 = [...main.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)];
  if (h1.length !== 1 || textOf(h1[0][1]) !== T.h1) P.push('AC-10 h1');
  const one = (cls) => { const m = new RegExp(`<p class="${cls}">([\\s\\S]*?)<\\/p>`).exec(main); return m ? textOf(m[1]) : null; };
  if (one('lede') !== T.lede) P.push('AC-10 lede');
  if (one('drift-meaning') !== T.meaning) P.push('AC-10 meaning sentences');
  if (one('drift-caution') !== T.caution) P.push('AC-14 the caution sentence is missing or changed');
  const how = [...main.matchAll(/<p class="drift-how">([\s\S]*?)<\/p>/g)];
  if (JSON.stringify(how.map((m) => textOf(m[1]))) !== JSON.stringify(T.how)) P.push('AC-10 how to read it');
  if (!how.some((m) => m[1].includes('<a href="/reports/002/">'))) P.push('AC-10 the makers sentence links Report 002');
  const keyGot = [...main.matchAll(/<p data-key="([^"]*)">([\s\S]*?)<\/p>/g)].map((m) => ({ s: m[1], text: textOf(m[2]), html: m[2] }));
  if (JSON.stringify(keyGot.map((k) => [k.s, k.text])) !== JSON.stringify(keyExpected(exp).map((k) => [k.s, k.text]))) P.push('AC-10 key entries');
  const router = keyGot.find((k) => k.s === 'ROUTER');
  if (router && !router.html.includes(`href="${policy.AMENDMENT}"`)) P.push('AC-10 router key link');
  // AC-9: no numeral outside the names, places, dates, notes and the key's library sentences.
  const bare = main.replace(/<span data-(?:place|date|model-name|note)>[^<]*<\/span>/g, '').replace(/<h3 data-subject-name>[\s\S]*?<\/h3>/g, '').replace(/<p data-key="[^"]*">[\s\S]*?<\/p>/g, '');
  const digit = /\d/.exec(textOf(bare));
  if (digit) P.push(`AC-9 a numeral outside the named spans: ${JSON.stringify(textOf(bare).slice(Math.max(0, digit.index - 30), digit.index + 30))}`);
  // AC-11 and AC-14: wording.
  const words = textOf(main);
  if (/—/.test(main)) P.push('AC-11 em dash');
  for (const { cls, re } of await lexicon) if (re.test(words)) P.push(`AC-11 band lexicon ${cls}`);
  if (/\bconfiden(t|tly|ce)\b|\bsignifican(t|tly|ce)\b/i.test(words)) P.push('AC-11 confidence language');
  if (BANNED_PHRASES.test(words)) P.push(`AC-14 release framing in the page: ${BANNED_PHRASES.exec(words)[0]}`);
  const head = [/<title>([^<]*)<\/title>/, /<meta name="description" content="([^"]*)">/, /<meta property="og:title" content="([^"]*)">/, /<meta property="og:description" content="([^"]*)">/].map((re) => (re.exec(html) || [])[1]).filter((v) => v !== undefined);
  for (const v of [...head, T.lede]) if (BANNED_WORDS.test(decode(v)) || BANNED_PHRASES.test(decode(v))) P.push(`AC-14 release framing in the head: ${v.slice(0, 60)}`);
  return P;
}
// The link a page carries to this one, and its words.
function linkProblems(html) {
  const m = [...html.matchAll(new RegExp(`<a href="${URL_PATH}">([^<]*)</a>([^<]*)`, 'g'))];
  if (!m.length) return ['AC-12 no link'];
  const P = [];
  for (const x of m) {
    if (decode(x[1]) !== T.h1) P.push('AC-12 link text is not the title');
    if (BANNED_WORDS.test(x[1] + x[2]) || BANNED_PHRASES.test(x[1] + x[2])) P.push('AC-14 release framing in the link');
  }
  return P;
}
const scriptSources = (html) => [...html.matchAll(/<script\b[^>]*\bsrc="([^"]*)"/g)].map((m) => m[1]).sort();

const archive = { entries: null, reportsOf: reportsOfArchive };
const ctx = () => { if (!archive.entries) archive.entries = publishedReceipts(); return archive; };
const page = () => read(`docs/${REL}`);

// ── the built page against the receipts ───────────────────────────────────────────────────────────
test('AC-1 to AC-16 the built page reads GREEN against the published receipts', async () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'docs', REL)), `docs/${REL} is not built`);
  assert.deepEqual(await checkPage(page(), ctx()), []);
  const rows = expectedRows(ctx().entries, { reportsOf: reportsOfArchive });
  assert.ok(rows.some((r) => r.list === 'main') && rows.some((r) => r.list === 'other'), 'both lists have rows to read');
  assert.deepEqual(rows.filter((r) => r.handoff).map((r) => r.name).sort(), ['grill-me', 'grill-with-docs'], 'the claim review names the two hand-off texts');
});

const rowsOf = (h) => [...h.matchAll(/<section class="drift-row"[\s\S]*?<\/section>/g)].map((m) => m[0]);
const plants = [
  ['AC-1', 'one reading removed', (h) => h.replace(/; <span class="drift-reading" data-receipt="[^"]*">[\s\S]*?\)<\/span>/, '')],
  ['AC-1', 'a row for a subject measured on one model', (h) => {
    const one = ctx().entries.find((x) => ctx().entries.filter((y) => y.receipt.skill.content_hash === x.receipt.skill.content_hash).length === 1);
    return h.replace('<section class="drift-row"', `<section class="drift-row" data-list="main" data-subject="${one.receipt.skill.content_hash}" data-tasks="same" data-grading="same" data-setup="same"><h3 data-subject-name>x</h3></section>\n<section class="drift-row"`);
  }],
  ['AC-1', 'one reading duplicated', (h) => h.replace(/(<span class="drift-reading" data-receipt="[^"]*">[\s\S]*?\)<\/span>)/, '$1; $1')],
  ['AC-1', 'a second-list row marked as the first list', (h) => h.replace('<section class="drift-row" data-list="other"', '<section class="drift-row" data-list="main"')],
  ['AC-2', 'a reading moved into a row of another text', (h) => {
    const rows = rowsOf(h);
    const span = /<span class="drift-reading"[\s\S]*?\)<\/span>/.exec(rows[1])[0];
    return h.replace(rows[0], rows[0].replace(/(<p class="drift-model"[^>]*>[\s\S]*?)(\.<\/p>)/, `$1; ${span}$2`));
  }],
  ['AC-3', 'a label shortened', (h) => h.replace(`>${LABELS.PASSED}</a>`, '>Helped</a>')],
  ['AC-4', 'a router reading given its plain verdict', (h) => {
    const x = ctx().entries.find((e) => policy.routerLimit(e.receipt));
    return h.replace(`data-receipt="${x.receipt.receipt_hash}"><a href="/r/${x.receipt.receipt_hash}/">${policy.LABEL}</a>`, `data-receipt="${x.receipt.receipt_hash}"><a href="/r/${x.receipt.receipt_hash}/">${plainOf(x.receipt).label}</a>`);
  }],
  ['AC-4', 'a router row\'s REASON removed', (h) => h.replace(/<p class="drift-router">[\s\S]*?<\/p>\n/, '')],
  ['AC-6', 'two links swapped', (h) => {
    const ls = [...h.matchAll(/<a href="(\/r\/[0-9a-f]{64}\/)">/g)].map((m) => m[1]);
    return h.replace(`<a href="${ls[0]}">`, '<a href="@A@">').replace(`<a href="${ls[1]}">`, `<a href="${ls[0]}">`).replace('<a href="@A@">', `<a href="${ls[1]}">`);
  }],
  ['AC-6', 'a link to no page', (h) => h.replace(/<a href="\/r\/[0-9a-f]{64}\/">/, `<a href="/r/${'0'.repeat(64)}/">`)],
  ['AC-7', 'a model paragraph filed under another model', (h) => h.replace(/<p class="drift-model" data-model="([^"]*)">/, (m, id) => `<p class="drift-model" data-model="${id === 'claude-opus-5-5' ? 'claude-sonnet-5-5' : 'claude-opus-5-5'}">`)],
  ['AC-7', 'one reading\'s place changed', (h) => h.replace(/(<span class="drift-reading"[^>]*><a [^>]*>[^<]*<\/a> \(<span data-place>)[^<]*/, '$1Report 999')],
  ['AC-7', 'one reading\'s date changed', (h) => h.replace(/<span data-date>(\d{4})/, (m, y) => `<span data-date>${Number(y) - 1}`)],
  ['AC-8', 'a row\'s task state flipped', (h) => h.replace(/data-tasks="(same|differ|unrecorded)"/, (m, v) => `data-tasks="${v === 'same' ? 'differ' : 'same'}"`)],
  ['AC-8', 'a named receipt changed', (h) => h.replace('The receipt from <span data-place>Report 017</span> records a different run setup', 'The receipt from <span data-place>Report 015</span> records a different run setup')],
  ['AC-8', 'a named list joined without its semicolon', (h) => h.replace('; and <span data-place>Report 011</span> on', ' and <span data-place>Report 011</span> on')],
  ['AC-8', 'a grading difference said generically', (h) => h.replace('was scored by a different version of the scoring code', 'records a different judge or grading')],
  ['AC-9', 'a score inserted', (h) => h.replace(/(<p class="drift-model"[^>]*>[\s\S]*?)(\.<\/p>)/, '$1, 0.906 with the skill$2')],
  ['AC-9', 'two rows swapped', (h) => { const rows = rowsOf(h); return h.replace(rows[0], '@R0@').replace(rows[1], rows[0]).replace('@R0@', rows[1]); }],
  ['AC-9', 'a comparing sentence added to a row', (h) => h.replace(/(<p class="drift-model")/, '<p>It helps more on the larger model.</p>\n$1')],
  ['AC-10', 'one key entry removed', (h) => h.replace(/<p data-key="[^"]*">[\s\S]*?<\/p>/, '')],
  ['AC-10', 'the third meaning sentence altered', (h) => h.replace('it does not mean the skill does nothing.', 'so the skill does nothing.')],
  ['AC-11', 'band lexicon inserted', (h) => h.replace('<p class="drift-how">', '<p class="drift-how">Most of these sit within noise. ')],
  ['AC-14', 'the caution sentence removed', (h) => h.replace(/<p class="drift-caution">[\s\S]*?<\/p>\n/, '')],
  ['AC-14', '"still help" inserted', (h) => h.replace('<p class="drift-caution">', '<p>Did the skills still help?</p>\n<p class="drift-caution">')],
  ['AC-14', '"break" in the title', (h) => h.replace('<title>The same skill', '<title>Did it break? The same skill')],
  ['AC-15', 'a row\'s dated note removed', (h) => h.replace(/<p class="drift-note">[\s\S]*?<\/p>\n/, '')],
  ['AC-15', 'a note quoted without its report\'s lead-in', (h) => h.replace('\'s note, on its own page: “', ' carries this dated note: “')],
  ['AC-10', 'the router gloss removed from the key', (h) => h.replace(` ${T.router}`, '')],
  ['AC-10', 'the answered_by gloss removed from the key', (h) => h.replace(` ${T.answeredBy}`, '')],
  ['AC-16', 'the hand-off note removed', (h) => h.replace(/<p class="drift-handoff">[\s\S]*?<\/p>\n/, '')],
];
for (const [ac, what, plant] of plants) {
  test(`${ac} plant: ${what} reads RED`, async () => {
    assert.ok(fs.existsSync(path.join(ROOT, 'docs', REL)), `docs/${REL} is not built`);
    const before = page();
    const after = plant(before);
    assert.notEqual(after, before, 'the plant changed the page');
    const problems = await checkPage(after, ctx());
    assert.ok(problems.some((p) => p.startsWith(`${ac} `)), `expected an ${ac} problem, got ${JSON.stringify(problems.slice(0, 4))}`);
  });
}

test('AC-10 the key oracle names a "Comparison unreliable" entry before the router', () => {
  const look = { warning: () => "Comparison unreliable: at least 5% of an arm's replies ended in fake tool calls.", label: () => 'Comparison unreliable', pageLabel: () => 'Passing' };
  assert.equal(keyEntry('UNRELIABLE', [{}], look), "Comparison unreliable: at least 5% of an arm's replies ended in fake tool calls. Its receipt page calls it “Passing”.");
  assert.deepEqual(keyOrder(new Map([['ROUTER', []], ['UNRELIABLE', []], ['PASSED', []]])), ['PASSED', 'UNRELIABLE', 'ROUTER']);
});

// ── the builder's call paths, on sealed fixtures ──────────────────────────────────────────────────
const base = () => clone(JSON.parse(read('receipts/report-014/run-1/code-review-and-quality-claude-haiku-5-5-2026-10-07.json')));
const other = () => clone(JSON.parse(read('receipts/report-014/run-1/code-review-and-quality-claude-haiku-4-5-20251001-2026-10-07.json')));
const fx = (name, r) => ({ rel: `receipts/fixture-639/${name}.json`, receipt: r });
const onModel = (r, id, edit = () => {}) => { const c = clone(r); c.run.model_id = id; edit(c); return sealReceipt(c); };
const reports014 = () => ['014'];
const quiet = { reportsOf: reports014, texts: new Map(), notes: () => null };

test('AC-2 two texts under one name are two rows, each with its own version note', async () => {
  const { driftRows, driftMain } = builder();
  const a2 = base(), b2 = other();
  a2.skill.content_hash = 'f'.repeat(64); b2.skill.content_hash = 'f'.repeat(64);
  sealReceipt(a2); sealReceipt(b2);
  const entries = [fx('a', base()), fx('b', other()), fx('a2', a2), fx('b2', b2)];
  const opts = { ...quiet, reportsOf: (r) => (r.skill.content_hash === 'f'.repeat(64) ? ['900'] : ['014']) };
  const rows = driftRows(entries, opts);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, rows[1].name);
  assert.notEqual(rows[0].subject, rows[1].subject);
  assert.deepEqual(await checkPage(driftMain(entries, opts), { entries, pages: false, ...opts }), []);
  assert.throws(() => driftRows(entries, quiet), /same|apart/i, 'two rows that would read the same are refused');
});

test('AC-1 a text measured on one model gets no row', () => {
  const { driftRows } = builder();
  const solo = other(); solo.skill.content_hash = 'e'.repeat(64); sealReceipt(solo);
  assert.deepEqual(driftRows([fx('a', base()), fx('solo', solo)], quiet), []);
  assert.equal(driftRows([fx('a', base()), fx('b', other()), fx('solo', solo)], quiet).length, 1);
});

test('AC-4 the committed router receipts read the router label through driftRows, in the second list', () => {
  const { driftRows } = builder();
  const routers = ctx().entries.filter((x) => policy.routerLimit(x.receipt) && x.receipt.skill.name === 'find-skills');
  assert.ok(routers.length >= 2);
  assert.ok(routers.some((x) => plainOf(x.receipt).label !== policy.LABEL), 'the plant matters: plainOf alone would give a skill verdict');
  const rows = driftRows(routers, { reportsOf: reportsOfArchive, texts: new Map(), notes: () => null });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].list, 'other');
  for (const m of rows[0].models) for (const r of m.readings) assert.equal(r.label, policy.LABEL);
});

test('AC-5 a receipt edited after sealing is refused', () => {
  const { driftRows } = builder();
  const a = base(); a.comparison.with_skill_score = 0.123456;
  assert.throws(() => driftRows([fx('a', a), fx('b', other())], quiet), /seal|verif/i);
});

test('AC-7 a row receipt no report lists, and two ids with one name, are refused', () => {
  const { driftRows } = builder();
  const a = base();
  assert.throws(() => driftRows([fx('a', a), fx('b', other())], { ...quiet, reportsOf: (r) => (r.receipt_hash === a.receipt_hash ? [] : ['014']) }), /report/i);
  assert.throws(() => driftRows([fx('a', onModel(base(), 'claude-haiku-4-5')), fx('b', other())], quiet), /name/i);
});

test('AC-8 each group moves alone, a judge counts as recorded on its rows, and self-grading reads different', async () => {
  const { driftRows, driftMain } = builder();
  const groups = (entries) => driftRows(entries, quiet)[0].conditions;
  const a = base();
  const pair = (edit, edit0 = () => {}) => { const a0 = clone(a); edit0(a0); return [fx('a', sealReceipt(a0)), fx('a2', onModel(a, 'claude-sonnet-5-5', (c) => { edit0(c); edit(c); }))]; };
  const same = { tasks: 'same', grading: 'same', setup: 'same' };
  assert.deepEqual(groups(pair(() => {})), same);
  assert.deepEqual(groups(pair((c) => { c.suite.suite_hash = 'd'.repeat(64); })), { ...same, tasks: 'differ' });
  assert.deepEqual(groups(pair((c) => { c.run.runner_version = '9.9.9'; })), { ...same, setup: 'differ' });
  assert.deepEqual(groups(pair((c) => { c.results.cases[0].judge.rubric_hash = 'c'.repeat(64); })), { ...same, grading: 'differ' });
  assert.deepEqual(groups(pair((c) => { c.run.timeout_ms = 1; })), { ...same, setup: 'differ' }, 'a TBD-2 setup field');
  assert.deepEqual(groups(pair((c) => { c.run.judge.code_revision = 'judge-code-x'; })), { ...same, grading: 'differ' }, 'a TBD-2 grading field');
  // M2: the run's judge removed while each arm row names its own stays recorded; both removed is unrecorded.
  assert.deepEqual(groups(pair(() => {}, (c) => { delete c.run.judge.model_id; })), same);
  assert.deepEqual(groups(pair(() => {}, (c) => { delete c.run.judge.model_id; for (const x of c.results.cases) delete x.judge.model_id; })), { ...same, grading: 'unrecorded' });
  // M1: the judge is the answering model in one receipt only, computed or sealed in scope.
  assert.deepEqual(groups([fx('a', a), fx('a2', onModel(a, a.run.judge.model_id))]), { ...same, grading: 'differ' });
  assert.deepEqual(groups(pair((c) => { c.run.judge.relationship = { same_model: true, comparison_scope: 'within-model', limitation: 'x' }; })), { ...same, grading: 'differ' });
  // A field compared where present: one receipt records the suite case and the other does not.
  assert.deepEqual(groups(pair((c) => { for (const x of c.results.cases) x.generation = { ...(x.generation || {}), suite_case: { prompt_hash: 'p', grading_hash: 'g' } }; })), same);
  for (const entries of [pair(() => {}), pair((c) => { c.suite.suite_hash = 'd'.repeat(64); }), pair(() => {}, (c) => { delete c.run.judge.model_id; for (const x of c.results.cases) delete x.judge.model_id; })]) {
    assert.deepEqual(await checkPage(driftMain(entries, quiet), { entries, pages: false, ...quiet }), []);
  }
  assert.ok(driftMain(pair((c) => { c.suite.suite_hash = 'd'.repeat(64); }), quiet).includes('The receipt from <span data-place>Report 014</span> on <span data-model-name>Claude Sonnet 5.5</span> records different test tasks.'));
});

test('AC-8 a grading difference is said by the field that moved', async () => {
  const { driftMain } = builder();
  const a = base();
  const named = (who) => `The receipt from <span data-place>Report 014</span> on <span data-model-name>${who}</span>`;
  const cases = [
    ['self', [fx('a', a), fx('a2', onModel(a, a.run.judge.model_id))], `${named(humanModelName(a.run.judge.model_id))} was scored by the same model that answered it.`],
    ['model', [fx('a', a), fx('a2', onModel(a, 'claude-sonnet-5-5', (c) => { c.run.judge.model_id = 'claude-sonnet-5'; for (const x of c.results.cases) x.judge.model_id = 'claude-sonnet-5'; }))], `${named('Claude Sonnet 5.5')} was scored by a different model.`],
    ['code', [fx('a', a), fx('a2', onModel(a, 'claude-sonnet-5-5', (c) => { c.run.judge.code_revision = 'judge-code-x'; }))], `${named('Claude Sonnet 5.5')} was scored by a different version of the scoring code.`],
    ['other', [fx('a', a), fx('a2', onModel(a, 'claude-sonnet-5-5', (c) => { c.results.cases[0].judge.rubric_hash = 'c'.repeat(64); }))], `${named('Claude Sonnet 5.5')} records different grading instructions or settings.`],
  ];
  for (const [kind, entries, sentence] of cases) {
    const html = driftMain(entries, quiet);
    assert.ok(html.includes(sentence), `${kind}: ${sentence}`);
    for (const k of ['self', 'model', 'code', 'other']) if (k !== kind) assert.ok(!html.includes(T.scored[k][0]), `${kind} is not said as ${k}`);
    assert.deepEqual(await checkPage(html, { entries, pages: false, ...quiet }), [], kind);
  }
});

test('AC-12 the page module\'s own CLI: --check rebuilds the page and compares it byte for byte', () => {
  const cli = (...args) => spawnSync(process.execPath, [path.join(ROOT, 'scripts/model-drift-page.js'), ...args], { cwd: ROOT, encoding: 'utf8', timeout: 600000 });
  const ok = cli('--check');
  assert.equal(ok.status, 0, ok.stderr);
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || '/var/tmp', 'across-models-check-'));
  fs.mkdirSync(path.join(dir, 'across-models'));
  const built = fs.readFileSync(path.join(ROOT, 'docs', REL));
  fs.writeFileSync(path.join(dir, REL), built);
  assert.equal(cli('--check', '--docs', dir).status, 0, 'an exact copy reads current');
  const planted = Buffer.from(built); planted[planted.length - 2] ^= 1;
  fs.writeFileSync(path.join(dir, REL), planted);
  const red = cli('--check', '--docs', dir);
  assert.equal(red.status, 1, 'plant: a one-byte edit makes --check exit 1');
  assert.match(red.stderr, /stale/);
  fs.rmSync(path.join(dir, REL));
  assert.equal(cli('--check', '--docs', dir).status, 1, 'plant: a missing page makes --check exit 1');
  assert.equal(cli('--bogus').status, 2, 'an unknown argument is refused');
});

test('AC-16 the hand-off rule reads only Skill tool instructions as a hand-off', () => {
  const { isHandoff } = builder();
  assert.equal(isHandoff('---\nname: x\n---\n\nCall the Skill tool with "grilling".\n'), true);
  assert.equal(isHandoff('---\nname: x\n---\n\nCall the Skill tool twice, for "a" and "b".'), true);
  assert.equal(isHandoff('---\nname: x\n---\n\nCall the Skill tool with "a".\nThen review the plan.\n'), false);
  assert.equal(isHandoff('---\nname: x\n---\n\n'), false);
});

// Issue 661: the builder reads a report's dated note by the tokenizer (CodeQL js/incomplete-multi-
// character-sanitization on the tag pattern it used): inline markup, a ">" inside a quoted attribute
// and a script in any letter case leave the note's words, each entity decoded once; on the real
// report pages the builder and this file's own reader agree.
test('issue 661: reportNote reads the note as text, by the tokenizer', () => {
  const { reportNote } = builder();
  const root = fs.mkdtempSync(path.join(process.env.TMPDIR || '/var/tmp', 'across-models-note-'));
  const dir = path.join(root, 'docs/reports/999');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), '<main><p class="muted interim-note" id="interim-note"><strong>Note, 2026-10-03.</strong> Counts <a title="a>b" href="/x/">here</a>&rsquo;s &amp; <SCRIPT>x()</SCRIPT > more.</p></main>');
  assert.equal(reportNote('999', root), 'Note, 2026-10-03. Counts here’s & more.');
  assert.equal(reportNote('998', root), null);
  for (const n of ['005', '007', '008']) {
    assert.ok(noteOfReport(n), `Report ${n} carries a note`);
    assert.equal(reportNote(n), noteOfReport(n), `Report ${n}: the builder and this file read the same note`);
  }
});

// ── generated and findable ────────────────────────────────────────────────────────────────────────
test('AC-12 the page is the site builder\'s output, with its head', () => {
  const { TARGETS } = require('../scripts/build-site-pages.js');
  const headTags = require('../scripts/build-head-tags.js');
  assert.equal(typeof TARGETS[REL], 'function', `build-site-pages.js has no target ${REL}`);
  const html = page();
  assert.equal(headTags.render(TARGETS[REL](), REL), html);
  assert.equal((/<title>([^<]*)<\/title>/.exec(html) || [])[1], T.title);
  assert.ok(T.title.length <= 60);
  const desc = decode((/<meta name="description" content="([^"]*)">/.exec(html) || [])[1] || '');
  assert.ok(desc.length >= 50 && desc.length <= 155, `description is ${desc.length} characters`);
  assert.equal(decode((/<meta property="og:description" content="([^"]*)">/.exec(html) || [])[1] || ''), desc);
  assert.ok(T.lede.startsWith(desc.replace(/…$/, '')), 'the description is taken from the first paragraph');
  assert.match(html, /<link rel="canonical" href="https:\/\/driftproofhq\.com\/across-models\/">/);
  assert.equal([...html.matchAll(/<h1\b/g)].length, 1);
});

test('AC-12 and AC-14 the homepage and /reports/ link the page by its title; the sitemap and llms.txt list it', () => {
  for (const f of ['docs/index.html', 'docs/reports/index.html']) assert.deepEqual(linkProblems(read(f)), [], f);
  const home = read('docs/index.html');
  assert.ok(linkProblems(home.split(`<a href="${URL_PATH}"`).join('<a href="/elsewhere/"')).length, 'plant: a homepage copy without the link reads RED');
  assert.ok(linkProblems(home.replace(`<a href="${URL_PATH}">${T.h1}</a>`, `<a href="${URL_PATH}">${T.h1}</a> after a new model`)).some((p) => p.startsWith('AC-14 ')), 'plant: "new" beside the link reads RED');
  const date = JSON.parse(read('docs/data/page-dates.json')).dates[REL];
  assert.match(String(date), /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(read('docs/sitemap-pages.xml').includes(`<url><loc>https://driftproofhq.com${URL_PATH}</loc><lastmod>${date}</lastmod></url>`));
  const llms = read('docs/llms.txt').split('\n').find((l) => l.includes(`](https://driftproofhq.com${URL_PATH})`));
  assert.ok(llms, 'llms.txt carries the page');
  assert.ok(!BANNED_WORDS.test(llms) && !BANNED_PHRASES.test(llms));
});

test('AC-12 every generator reports the tree current', { timeout: 900000 }, () => {
  for (const s of ['build-site-pages.js', 'model-drift-page.js', 'build-head-tags.js', 'build-sitemap.js', 'build-llms.js']) {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', s), '--check'], { cwd: ROOT, encoding: 'utf8', timeout: 600000 });
    assert.equal(r.status, 0, `${s} --check: ${(r.stderr || r.stdout || '').slice(0, 400)}`);
  }
});

test('AC-13 the page loads no script source a plain site page does not', () => {
  const plain = scriptSources(read('docs/glossary/index.html'));
  assert.deepEqual(scriptSources(page()), plain);
  assert.notDeepEqual(scriptSources(page().replace('</main>', '<script src="/x.js"></script></main>')), plain, 'plant: an added script source reads RED');
});

test('AC-13 Chromium at 1280 and 390 px: no sideways scroll on a phone', { timeout: 300000 }, async (t) => {
  const { chromium } = require('playwright');
  const shots = fs.mkdtempSync(path.join(process.env.TMPDIR || '/var/tmp', 'across-models-shots-'));
  const server = http.createServer((req, res) => {
    let file = path.resolve(ROOT, 'docs', '.' + new URL(req.url, 'http://localhost').pathname);
    if (!file.startsWith(path.join(ROOT, 'docs') + path.sep)) return res.writeHead(403).end();
    try {
      if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
      res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream');
      res.end(fs.readFileSync(file));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.route('**/*', (route) => (new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort()));
    const p = await context.newPage();
    await p.goto(`http://127.0.0.1:${server.address().port}${URL_PATH}`, { waitUntil: 'networkidle' });
    assert.equal(await p.locator('section.drift-row').count(), expectedRows(ctx().entries, { reportsOf: reportsOfArchive }).length);
    const wide = path.join(shots, 'across-models-1280.png'), phone = path.join(shots, 'across-models-390.png');
    await p.screenshot({ path: wide, fullPage: true });
    await p.setViewportSize({ width: 390, height: 844 });
    await p.screenshot({ path: phone, fullPage: true });
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no sideways scroll at 390 px');
    await p.evaluate(() => { const d = document.createElement('div'); d.style.width = '2000px'; d.style.height = '1px'; document.querySelector('main').append(d); });
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), 'plant: a wide element is detected');
    t.diagnostic(`screenshots: ${wide} ${phone}`);
  } finally { if (browser) await browser.close(); await new Promise((resolve) => server.close(resolve)); }
});
