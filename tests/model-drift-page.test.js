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
  title: 'The same skill on different models and dates | Driftproof',
  h1: 'The same skill on different models and dates',
  lede: 'Driftproof measured some skills and instruction files on more than one model, and some with the same tests on different dates. Here is what each receipt read, linked to the receipt.',
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

// ── spec 731: the same skill and the same tests on different dates (the spec's own copy of its texts) ──
const { buildDriftReport } = require('../lib/diff');
const { judgeSamplesOrNull } = require('../lib/counts');
const { kindOf: subjectKind, deliveryOf: subjectDelivery, validateReceipt, SCHEMA_FILES } = require('../lib/receipt');
const { canonicalModelId } = require('../lib/usage');
const { sha256 } = require('../lib/canonical');
const D = {
  heading: 'The same skill and the same tests on different dates',
  how: 'Where receipts from two or more dates record the same skill text, the same test tasks, the same model, the same judge model and number of judge samples, the same answer capture, and the same arms, they are listed here by date: each with the version of Driftproof that ran it, the harness it ran in, the average score with the skill and without it, each with its band, and a link to the receipt. Between each two receipts is what Driftproof read when it compared that pair as a release comparison, with its label written in plain words.',
  setup: (model) => `Every receipt in this group records the same skill text, the same test tasks and the same model, ${model}, scored by the same judge model with the same number of judge samples, with the answer captured the same way.`,
  judge: { same: 'The judge was the same model as the one measured.', other: 'The judge was a different model from the one measured.' },
  harnessNone: 'harness not recorded',
  notMeasured: 'not measured',
  noBand: 'no band',
  pair: (a, b) => (a === b ? `Comparing two receipts of ${a}, Driftproof read:` : `Comparing ${a} with ${b}, Driftproof read:`),
  fn: 'lib/diff.js buildDriftReport release',
  // The mapping and a refused pair's words (A-731-2), the spec's own copy.
  labels: [['NO SEPARATION DETECTED', 'No separation detected'], ['DRIFT', 'A separation detected, downward'], ['IMPROVED', 'A separation detected, upward'], ['MIXED', 'A separation detected both ways'], ['INCONCLUSIVE', 'Inconclusive'], ['NOT MEASURED', 'Not measured'], ['REFUSED', 'Refused']],
  refused: (task, first, second, more) => `on the task ${task}, the scores without the skill averaged ${first} in the first receipt and ${second} in the second, and their bands do not overlap.${more ? ` The same held on ${more}.` : ''} No verdict is asserted, and the cause cannot be established.`,
  key: [
    'A separation between two dates is detected under the rule, never attributed. Between the dates any of these could have moved: the model behind the name, the harness that ran it, Driftproof\'s own version and scoring code, the judge\'s own variation, and chance. This page does not say which one made the difference.',
    'Where the judge is the same model as the one measured, a change in that model also changes the scoring, so the two cannot be told apart.',
    'No separation is not evidence of sameness: it means no test task separated under the rule at this sample size.',
    'A refusal is a result: where the scores without the skill did not reproduce between the dates, Driftproof forms no verdict and cannot say what caused the change.',
    'Driftproof\'s comparison puts a label before each reading. This page writes each label in plain words and keeps the rest of the reading as printed, except a refusal, which it writes out with the test tasks it rests on. Downward means the answers with the skill scored lower in the second of the two receipts, and upward that they scored higher. The plain words are:',
  ],
};
// The words that attribute a separation or give it a direction (731 AC-7), and an internal name.
const DIRECTION = /\bgot (?:better|worse)\b|\bworse\b|\bbetter\b|\bimproved\b|\bdegraded\b/i;
const INTERNAL_NAME = /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b|\b[a-z]+_[a-z_]+_[a-z_]+\b/;
// The differ's labels as it prints them, and the words only its own reader uses (A-731-2).
const RAW_LABEL = new RegExp(`\\b(?:${D.labels.map(([l]) => l).join('|')})\\b`);
const DIFFER_JARGON = /\bthis run\b|\bbaseline arm\b|\bcontrol\b/i;
// The shell's plain-word markers (spec 689) may wrap a word inside the quoted headline, so the span is
// read to its close and its text through the tokenizer.
const HEADLINE_SPAN = /<span data-headline>[\s\S]*?<\/span>/g;
const DATA_EL = /<data\b[^>]*>[^<]*<\/data>/g;

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
  // A-639-5 (issue 742): a receipt under receipts/canary/ that no report lists is placed as the canary run.
  if (!ns.length) return /^receipts\/canary\//.test(x.rel) ? 'canary run' : null;
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
  // By their reports only where every named receipt has one (A-639-5).
  if (reps.length && named.every((x) => row.rep.get(x).length) && row.xs.filter((x) => row.rep.get(x).some((n) => reps.includes(n))).every((x) => named.includes(x))) return `${noun} from ${reportsText(reps)}`;
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

function expectedRows(allEntries, { reportsOf, texts = textsOracle(), notes = noteOfReport }) {
  // A-639-8 (issue 743): a row's receipts are those some report lists, or that A-639-5 places as the canary run. Rows only.
  const entries = allEntries.filter((x) => reportsOf(x.receipt).length > 0 || /^receipts\/canary\//.test(x.rel));
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
  // AC-9: no numeral outside the names, places, dates, notes and the key's library sentences, and
  // (A-639-4) the dates list's bound <data> elements and quoted headlines.
  const bare = main.replace(/<span data-(?:place|date|model-name|note)>[^<]*<\/span>/g, '').replace(/<h3 data-subject-name>[\s\S]*?<\/h3>/g, '').replace(/<p data-key="[^"]*">[\s\S]*?<\/p>/g, '').replace(DATA_EL, '').replace(HEADLINE_SPAN, '');
  const digit = /\d/.exec(textOf(bare));
  if (digit) P.push(`AC-9 a numeral outside the named spans: ${JSON.stringify(textOf(bare).slice(Math.max(0, digit.index - 30), digit.index + 30))}`);
  // AC-11 and AC-14: wording. The em dash reading sets aside the differ's quoted headlines (A-639-4).
  const words = textOf(main);
  if (/—/.test(main.replace(HEADLINE_SPAN, ''))) P.push('AC-11 em dash');
  for (const { cls, re } of await lexicon) if (re.test(words)) P.push(`AC-11 band lexicon ${cls}`);
  if (/\bconfiden(t|tly|ce)\b|\bsignifican(t|tly|ce)\b/i.test(words)) P.push('AC-11 confidence language');
  if (BANNED_PHRASES.test(words)) P.push(`AC-14 release framing in the page: ${BANNED_PHRASES.exec(words)[0]}`);
  const head = [/<title>([^<]*)<\/title>/, /<meta name="description" content="([^"]*)">/, /<meta property="og:title" content="([^"]*)">/, /<meta property="og:description" content="([^"]*)">/].map((re) => (re.exec(html) || [])[1]).filter((v) => v !== undefined);
  for (const v of [...head, T.lede]) if (BANNED_WORDS.test(decode(v)) || BANNED_PHRASES.test(decode(v))) P.push(`AC-14 release framing in the head: ${v.slice(0, 60)}`);
  // Spec 731: the dates list.
  P.push(...checkDates(main, { entries, reportsOf, pages }));
  return P;
}
// ── spec 731's oracle: the dates groups, rebuilt from the receipts ────────────────────────────────
const VERSIONS = Object.keys(SCHEMA_FILES);
const day = (x) => String(x.receipt.run.date_utc).slice(0, 10);
const n3 = (v) => Number(v).toFixed(3);
// The capture mode: recorded, or text for a receipt before schema 0.10 (that runner had one capture).
function captureOf(r) {
  const m = get(r, 'run.capture.mode');
  if (typeof m === 'string') return m;
  const at = VERSIONS.indexOf(r.schema_version);
  return at >= 0 && at < VERSIONS.indexOf('0.10') ? 'text' : null;
}
// The judge models, canonical, when every arm row records one.
function judgesOf(r) {
  const rows = arms(r);
  const js = rows.map((c) => get(c, 'judge.model_id') ?? get(r, 'run.judge.model_id'));
  if (!rows.length || js.some(none)) return null;
  return [...new Set(js.map((j) => canonicalModelId(j)))].sort();
}
// The arm set (A-731-1): the modes the rows carry, and the placebo arm where its block is sealed.
const armSet = (r) => [...new Set([...((r.results || {}).cases || []).map((c) => c.mode), ...(r.placebo ? ['placebo'] : [])])].sort();
function groupKey(r) {
  const judges = judgesOf(r); const n = judgeSamplesOrNull(r); const cap = captureOf(r);
  const k = subjectKind(r).value; const d = subjectDelivery(r).value;
  if (!judges || n === null || cap === null || k === 'unknown' || d === 'unknown') return null;
  return JSON.stringify([r.skill.content_hash, r.suite.suite_hash, canonicalModelId(r.run.model_id), r.run.surface, judges, n, cap, k, d, armSet(r)]);
}
const judgeSelf = (r) => { const s = get(r, 'run.judge.relationship'); return s && s.comparison_scope === 'within-model' && typeof s.same_model === 'boolean' ? s.same_model : (judgesOf(r) || []).includes(canonicalModelId(r.run.model_id)); };
// The pair's headline: the first non-empty line under "## Headline", its bold markers off (spec 031 AC-3 reads it so).
function headlineOf(a, b) {
  try {
    const rep = buildDriftReport(a.receipt, b.receipt, { labelA: day(a), labelB: day(b), mode: 'release' });
    const ls = rep.markdown.split('\n'); const i = ls.findIndex((l) => /^## Headline\s*$/.test(l));
    const line = i < 0 ? '' : (ls.slice(i + 1).find((l) => l.trim()) || '');
    const text = line.trim().replace(/^\*\*/, '').replace(/\*\*$/, '');
    // A-731-2: the label, its plain words, and the words after it.
    const m = /^([A-Z][A-Z ]*[A-Z])(?:: | — )([\s\S]*)$/.exec(text);
    const entry = m && D.labels.find(([l]) => l === m[1]);
    return { text, refusal: rep.refusal_key || null, label: m ? m[1] : null, plain: entry ? entry[1] : null, rest: m ? m[2] : null };
  } catch (e) { return { text: null, error: e.message }; }
}
// The answers without the skill on one task, read here from the row: the mean, its spread, and its field.
function withoutSkill(c) {
  const g = c.generation;
  const sd = (v) => (typeof v === 'number' ? v : 0);
  if (g && typeof g.mean === 'number') return { mean: g.mean, sd: sd(g.sd), at: 'generation.mean' };
  return typeof c.mean === 'number' ? { mean: c.mean, sd: sd(c.stddev), at: 'mean' } : { mean: c.score, sd: sd(c.stddev), at: 'score' };
}
// The tasks a refused pair rests on, rebuilt from the two receipts: every task the second receipt holds
// whose answers without the skill have bands that do not overlap the first receipt's.
function refusedTasksOf(a, b) {
  const rows = (x) => arms(x.receipt).filter((c) => c.mode === 'baseline');
  const out = [];
  for (const nb of rows(b)) {
    const ob = rows(a).find((c) => c.id === nb.id);
    if (!ob) continue;
    const A = withoutSkill(ob), B = withoutSkill(nb);
    if (A.mean - A.sd > B.mean + B.sd || B.mean - B.sd > A.mean + A.sd) out.push({ id: nb.id, a: A, b: B });
  }
  return out;
}
const armText = (r, arm) => {
  if (r.run && r.run.status === 'incomplete') return D.notMeasured;
  const a = get(r, `results.aggregates.${arm}`) || {};
  if (typeof a.mean_score !== 'number') return D.notMeasured;
  return typeof a.stddev === 'number' ? `${n3(a.mean_score)} ± ${n3(a.stddev)}` : `${n3(a.mean_score)} ${D.noBand}`;
};
// The <data> elements a row binds, in order: runner, harness, the four figures.
function rowFigures(r) {
  const out = [{ at: 'run.runner_version', value: r.run.runner_version }];
  const h = get(r, 'run.harness');
  if (h && typeof h.name === 'string') { out.push({ at: 'run.harness.name', value: h.name }); if (h.version !== undefined && h.version !== null) out.push({ at: 'run.harness.version', value: h.version }); }
  if (!(r.run && r.run.status === 'incomplete')) {
    for (const arm of ['with_skill', 'baseline']) {
      const a = get(r, `results.aggregates.${arm}`) || {};
      if (typeof a.mean_score !== 'number') continue;
      out.push({ at: `results.aggregates.${arm}.mean_score`, value: a.mean_score, text: n3(a.mean_score) });
      if (typeof a.stddev === 'number') out.push({ at: `results.aggregates.${arm}.stddev`, value: a.stddev, text: n3(a.stddev) });
    }
  }
  return out.map((f) => ({ ...f, value: String(f.value), text: f.text === undefined ? String(f.value) : f.text }));
}
const harnessText = (r) => { const h = get(r, 'run.harness'); return h && typeof h.name === 'string' ? `harness ${h.name}${h.version !== undefined && h.version !== null ? ` ${h.version}` : ''}` : D.harnessNone; };
function expectedDates(entries, reportsOf) {
  const by = new Map();
  for (const x of entries) { const k = groupKey(x.receipt); if (k === null) continue; if (!by.has(k)) by.set(k, []); by.get(k).push(x); }
  const groups = [];
  for (const [key, xs0] of by) {
    // A-731-1: two or more distinct dates, so a same-day group is not listed.
    if (xs0.length < 2 || new Set(xs0.map(day)).size < 2) continue;
    const xs = [...xs0].sort((a, b) => cmp(a.receipt.run.date_utc, b.receipt.run.date_utc) || cmp(a.rel, b.rel));
    const r0 = xs[0].receipt;
    const selves = xs.map((x) => judgeSelf(x.receipt));
    const g = {
      key, id: sha256(key), subject: r0.skill.content_hash, name: subjectName(xs[0].rel, r0), model: humanModelName(r0.run.model_id), xs, first: r0.run.date_utc,
      judge: selves.every(Boolean) ? 'same' : selves.every((s) => !s) ? 'other' : 'mixed',
      pairs: xs.slice(1).map((b, i) => ({ a: xs[i], b, ...headlineOf(xs[i], b) })),
    };
    g.place = new Map(xs.map((x) => { const ns = [...new Set(reportsOf(x.receipt))].sort(); return [x, ns.length ? placeOf(x, reportsOf) : null]; }));
    g.rowText = new Map(xs.map((x) => [x, `${day(x)}${g.place.get(x) ? ` (${g.place.get(x)})` : ''}: Driftproof ${x.receipt.run.runner_version}, ${harnessText(x.receipt)}. With the skill ${armText(x.receipt, 'with_skill')}, without it ${armText(x.receipt, 'baseline')}.`]));
    groups.push(g);
  }
  groups.sort((a, b) => cmp(a.name.toLowerCase(), b.name.toLowerCase()) || cmp(a.first, b.first) || cmp(a.key, b.key));
  return groups;
}
// Every problem the dates list has against the receipts, each tagged 731-AC-n.
function checkDates(main, { entries, reportsOf, pages = true }) {
  const P = [];
  const exp = expectedDates(entries, reportsOf);
  const entryOf = new Map(entries.map((x) => [x.receipt.receipt_hash, x]));
  const iOther = main.indexOf(`<h2>${T.other}</h2>`); const iDates = main.indexOf(`<h2>${D.heading}</h2>`); const iKey = main.indexOf(`<h2 id="key">${T.key}</h2>`);
  if (iDates < 0 || iDates < iOther || iKey < iDates) P.push('731-AC-8 the dates heading is missing or out of place');
  const how = /<p class="dates-how">([\s\S]*?)<\/p>/.exec(main);
  if (!how || textOf(how[1]) !== D.how) P.push('731-AC-8 the how paragraph of the dates list');
  const got = [...main.matchAll(/<section class="drift-dates" data-group="([^"]*)" data-subject="([^"]*)">([\s\S]*?)<\/section>/g)].map((m) => ({ id: m[1], subject: m[2], body: m[3] }));
  for (const s of [...main.matchAll(/<section class="drift-dates"/g)]) if (s.index < iDates || s.index > iKey) P.push('731-AC-8 a dates group outside the dates list');
  const want = new Map(exp.map((g) => [g.id, g]));
  for (const g of got) if (!want.has(g.id)) P.push(`731-AC-1 extra group ${g.id.slice(0, 12)} (${g.subject.slice(0, 12)})`);
  for (const g of exp) if (!got.some((h) => h.id === g.id)) P.push(`731-AC-1 missing group ${g.name} on ${g.model} (${g.xs.map(day).join(', ')})`);
  const order = got.map((g) => g.id).filter((id) => want.has(id));
  if (JSON.stringify(order) !== JSON.stringify(exp.map((g) => g.id).filter((id) => order.includes(id)))) P.push('731-AC-4 groups out of order');
  for (const h of got) {
    const g = want.get(h.id);
    if (!g) continue;
    if (h.subject !== g.subject) P.push(`731-AC-1 group ${g.name} names another text`);
    const name = /<h3 data-subject-name>([\s\S]*?)<\/h3>/.exec(h.body);
    if (!name || textOf(name[1]) !== g.name) P.push(`731-AC-1 group name for ${g.name}`);
    const setup = /<p class="dates-setup">([\s\S]*?)<\/p>/.exec(h.body);
    const judgeAttr = /<span data-judge="([^"]*)">/.exec(h.body);
    if (g.judge === 'mixed') P.push(`731-AC-6 ${g.name}: the receipts do not agree on whether the judge is the model; the builder must refuse`);
    else if (!setup || textOf(setup[1]) !== `${D.setup(g.model)} ${D.judge[g.judge]}` || !judgeAttr || judgeAttr[1] !== g.judge) P.push(`731-AC-6 setup paragraph of ${g.name}: ${setup ? JSON.stringify(textOf(setup[1]).slice(0, 120)) : 'missing'}`);
    const rows = [...h.body.matchAll(/<li class="dates-row" data-receipt="([^"]*)">([\s\S]*?)<\/li>/g)].map((m) => ({ hash: m[1], body: m[2] }));
    if (rows.length < 2) P.push(`731-AC-1 ${g.name}: a group with ${rows.length} receipt${rows.length === 1 ? '' : 's'}`);
    const wantHashes = g.xs.map((x) => x.receipt.receipt_hash);
    for (const r of rows) if (!wantHashes.includes(r.hash)) P.push(`731-AC-1 ${g.name}: a receipt not of this group ${r.hash.slice(0, 12)}`);
    for (const x of wantHashes) { const n = rows.filter((r) => r.hash === x).length; if (n !== 1) P.push(`731-AC-1 ${g.name}: receipt ${x.slice(0, 12)} appears ${n} times`); }
    const seq = rows.map((r) => r.hash).filter((x) => wantHashes.includes(x));
    if (JSON.stringify([...new Set(seq)]) !== JSON.stringify(wantHashes.filter((x) => seq.includes(x)))) P.push(`731-AC-4 ${g.name}: rows out of order`);
    for (const r of rows) {
      const x = entryOf.get(r.hash);
      if (!x || !g.xs.includes(x)) continue;
      const a = /<a href="([^"]*)">/.exec(r.body);
      if (!a || a[1] !== `/r/${r.hash}/`) P.push(`731-AC-2 ${g.name}: row ${r.hash.slice(0, 12)} links ${a ? a[1] : 'nothing'}`);
      if (pages && a) { const f = path.join(ROOT, 'docs', a[1], 'index.html'); if (!fs.existsSync(f) || !fs.readFileSync(f, 'utf8').includes(r.hash)) P.push(`731-AC-2 ${a[1]} is not that receipt's page`); }
      const d = /<span data-date>([^<]*)<\/span>/.exec(r.body);
      if (!d || d[1] !== day(x)) P.push(`731-AC-2 ${g.name}: row ${r.hash.slice(0, 12)} date ${d ? d[1] : 'missing'}`);
      const figs = [...r.body.matchAll(/<data value="([^"]*)" data-src="([^"]*)" data-at="([^"]*)">([^<]*)<\/data>/g)].map((m) => ({ value: decode(m[1]), src: decode(m[2]), at: m[3], text: decode(m[4]) }));
      const wantFigs = rowFigures(x.receipt).map((f) => ({ value: f.value, src: x.rel, at: f.at, text: f.text }));
      if (JSON.stringify(figs) !== JSON.stringify(wantFigs)) P.push(`731-AC-2 ${g.name}: row ${r.hash.slice(0, 12)} figures ${JSON.stringify(figs).slice(0, 160)}`);
      if ([...r.body.matchAll(/<data\b/g)].length !== figs.length) P.push(`731-AC-2 ${g.name}: a data element without its binding`);
      if (textOf(r.body) !== g.rowText.get(x)) P.push(`731-AC-2 ${g.name}: row text ${JSON.stringify(textOf(r.body).slice(0, 160))}`);
    }
    const pairs = [...h.body.matchAll(/<li class="dates-pair"([^>]*)>([\s\S]*?)<\/li>/g)].map((m) => ({ a: attrs(m[1]), body: m[2] }));
    if (pairs.length !== g.pairs.length) P.push(`731-AC-3 ${g.name}: ${pairs.length} pair lines for ${g.pairs.length} pairs`);
    g.pairs.forEach((p, i) => {
      const got2 = pairs[i];
      if (!got2) return;
      if (p.text === null) { P.push(`731-AC-3 ${g.name}: the differ throws for a pair the page shows: ${p.error}`); return; }
      const where = `${g.name}: pair ${day(p.a)} to ${day(p.b)}`;
      if (!p.plain) { P.push(`731-AC-3 ${where}: a label outside the mapping: ${p.text.slice(0, 40)}`); return; }
      if (got2.a.src !== `${p.a.rel} ${p.b.rel}` || got2.a.fn !== D.fn) P.push(`731-AC-3 ${where} is not bound to both receipts and the differ`);
      if ((got2.a.refusal || null) !== p.refusal) P.push(`731-AC-3 ${where} refusal attribute ${got2.a.refusal || 'absent'}`);
      if (got2.a.label !== p.label) P.push(`731-AC-3 ${where} label attribute ${got2.a.label || 'absent'}`);
      const shown = /<b data-plain>([\s\S]*?)<\/b>/.exec(got2.body);
      if (!shown || textOf(shown[1]) !== p.plain) P.push(`731-AC-3 ${where} label reads ${shown ? JSON.stringify(textOf(shown[1])) : 'nothing'}`);
      const lead = D.pair(day(p.a), day(p.b));
      if (p.label !== 'REFUSED') {
        const span = /<span data-headline>([\s\S]*?)<\/span>/.exec(got2.body);
        if (!span || textOf(span[1]) !== p.rest) P.push(`731-AC-3 ${where} reads ${span ? JSON.stringify(textOf(span[1]).slice(0, 80)) : 'no headline'}`);
        if (textOf(got2.body) !== `${lead} ${p.plain}: ${p.rest}`) P.push(`731-AC-3 ${g.name}: pair line text ${JSON.stringify(textOf(got2.body).slice(0, 120))}`);
        return;
      }
      // A refused pair, in fixed words: every task and figure rebuilt from the two receipts (A-731-2).
      const tasks = refusedTasksOf(p.a, p.b);
      if (!tasks.length) { P.push(`731-AC-3 ${where}: refused with no task the receipts show`); return; }
      const [first, ...others] = tasks;
      const task = (id) => ({ value: id, src: p.b.rel, at: `results.cases[${id}/baseline].id`, text: id });
      const mean = (x, v) => ({ value: String(v.mean), src: x.rel, at: `results.cases[${first.id}/baseline].${v.at}`, text: n3(v.mean) });
      const wantFigs = [task(first.id), mean(p.a, first.a), mean(p.b, first.b), ...others.map((t) => task(t.id))];
      const figs = [...got2.body.matchAll(/<data value="([^"]*)" data-src="([^"]*)" data-at="([^"]*)">([^<]*)<\/data>/g)].map((m) => ({ value: decode(m[1]), src: decode(m[2]), at: decode(m[3]), text: decode(m[4]) }));
      if (JSON.stringify(figs) !== JSON.stringify(wantFigs)) P.push(`731-AC-3 ${where}: refused figures ${JSON.stringify(figs).slice(0, 200)}`);
      const named = others.map((t) => t.id);
      const words = D.refused(first.id, n3(first.a.mean), n3(first.b.mean), named.length ? `${named.length === 1 ? 'the task' : 'the tasks'} ${and(named)}` : '');
      if (textOf(got2.body) !== `${lead} ${p.plain}: ${words}`) P.push(`731-AC-3 ${g.name}: refused pair text ${JSON.stringify(textOf(got2.body).slice(0, 160))}`);
      // The figures are the differ's own: its headline names the same two, to its six places.
      const printed = /observed ([0-9.]+), the earlier receipt recorded ([0-9.]+)/.exec(p.text);
      if (!printed || Math.abs(Number(printed[1]) - first.b.mean) > 5e-7 || Math.abs(Number(printed[2]) - first.a.mean) > 5e-7) P.push(`731-AC-3 ${where}: the figures are not the differ's: ${p.text.slice(0, 120)}`);
    });
    // AC-7 in the list: no numeral outside the bound elements, no internal name, no direction word.
    const bare = h.body.replace(DATA_EL, '').replace(HEADLINE_SPAN, '').replace(/<span data-(?:date|place|model-name)>[^<]*<\/span>/g, '').replace(/<h3 data-subject-name>[\s\S]*?<\/h3>/g, '');
    const digit = /\d/.exec(textOf(bare));
    if (digit) P.push(`731-AC-7 a numeral in the dates list: ${JSON.stringify(textOf(bare).slice(Math.max(0, digit.index - 30), digit.index + 30))}`);
    const words = textOf(h.body.replace(HEADLINE_SPAN, ''));
    if (INTERNAL_NAME.test(words)) P.push(`731-AC-7 an internal name in the dates list: ${INTERNAL_NAME.exec(words)[0]}`);
  }
  const keys = [...main.matchAll(/<p class="dates-key" data-dates-key="([^"]*)">([\s\S]*?)<\/p>/g)].map((m) => [m[1], textOf(m[2])]);
  if (JSON.stringify(keys) !== JSON.stringify(D.key.map((k, i) => [String(i + 1), k]))) P.push(`731-AC-6 key sentences: ${JSON.stringify(keys.map((k) => k[1].slice(0, 40)))}`);
  const shownMap = [...main.matchAll(/<li data-differ-label="([^"]*)">([\s\S]*?)<\/li>/g)].map((m) => [decode(m[1]), textOf(m[2])]);
  if (JSON.stringify(shownMap) !== JSON.stringify(D.labels)) P.push(`731-AC-6 the mapping: ${JSON.stringify(shownMap).slice(0, 160)}`);
  const outside = textOf(main.replace(HEADLINE_SPAN, ''));
  if (DIRECTION.test(outside)) P.push(`731-AC-7 direction word: ${DIRECTION.exec(outside)[0]}`);
  // A-731-2: what a reader sees of the list carries no label as the differ prints it, and none of its reader's
  // words. Names and task ids are the receipts' own.
  const seen = iDates < 0 ? '' : textOf(main.slice(iDates, iKey).replace(DATA_EL, '').replace(/<h3 data-subject-name>[\s\S]*?<\/h3>/g, ''));
  if (RAW_LABEL.test(seen)) P.push(`731-AC-7 a raw differ label on the dates list: ${RAW_LABEL.exec(seen)[0]}`);
  if (DIFFER_JARGON.test(seen)) P.push(`731-AC-7 the differ's own words on the dates list: ${DIFFER_JARGON.exec(seen)[0]}`);
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

// The real receipts the rule keeps apart (A-731-1), read by this file's own key: a group on one date,
// and two receipts that share every field but the arm set, on two dates.
const keyedBy = (keyOf) => { const by = new Map(); for (const x of ctx().entries) { const k = keyOf(x.receipt); if (k === null) continue; if (!by.has(k)) by.set(k, []); by.get(k).push(x); } return [...by]; };
const withoutArms = (r) => { const k = groupKey(r); return k === null ? null : JSON.stringify(JSON.parse(k).slice(0, -1)); };
const sameDayGroup = () => keyedBy(groupKey).find(([, xs]) => xs.length >= 2 && new Set(xs.map(day)).size === 1);
const mixedArmsGroup = () => keyedBy(withoutArms).find(([, xs]) => new Set(xs.map((x) => JSON.stringify(armSet(x.receipt)))).size === 2 && new Set(xs.map(day)).size >= 2);
// A group section for those receipts, in the page's markup, put before the first listed group.
function withGroup(h, [key, xs]) {
  const rows = xs.map((x) => `<li class="dates-row" data-receipt="${x.receipt.receipt_hash}"><a href="/r/${x.receipt.receipt_hash}/"><span data-date>${day(x)}</span></a></li>`).join('\n');
  const section = `<section class="drift-dates" data-group="${sha256(key)}" data-subject="${xs[0].receipt.skill.content_hash}">\n<h3 data-subject-name>x</h3>\n<ol class="dates-rows">\n${rows}\n</ol>\n</section>\n`;
  return h.replace('<section class="drift-dates"', () => `${section}<section class="drift-dates"`);
}

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
  // Issue 680: the plant reads the report the page names in its run-setup sentence and swaps it for
  // another, so a report joining or leaving that sentence cannot leave the plant changing nothing.
  ['AC-8', 'a named receipt changed', (h) => h.replace(new RegExp(`The receipts? from (?:(?!The receipts? from)[\\s\\S])*? records? ${T.differs.setup}`), (sentence) =>
    sentence.replace(/(<span data-place>Reports? )(\d{3})/, (m, lead, n) => `${lead}${n === '015' ? '014' : '015'}`))],
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
  // The gloss is read through the plain-word marker spec 689 writes over "router" (A-639-4).
  ['AC-10', 'the router gloss removed from the key', (h) => h.replace(/ Here a (?:<[^>]*>)*router(?:<[^>]*>)* is a skill that mostly hands the task to other skills\./, '')],
  ['AC-10', 'the answered_by gloss removed from the key', (h) => h.replace(` ${T.answeredBy}`, '')],
  ['AC-16', 'the hand-off note removed', (h) => h.replace(/<p class="drift-handoff">[\s\S]*?<\/p>\n/, '')],
  // ── spec 731: the dates list ──
  ['731-AC-1', 'a row for a receipt whose suite hash differs by one byte, inserted into a group', (h) => {
    const g = expectedDates(ctx().entries, reportsOfArchive)[0];
    const suite = g.xs[0].receipt.suite.suite_hash;
    const flipped = suite.slice(0, -1) + (suite.endsWith('0') ? '1' : '0');
    const other = ctx().entries.find((x) => x.receipt.suite.suite_hash !== suite && x.receipt.suite.suite_hash !== flipped) || ctx().entries.find((x) => !g.xs.includes(x));
    const row = /<li class="dates-row" data-receipt="([^"]*)">[\s\S]*?<\/li>/.exec(h);
    return h.replace(row[0], `${row[0].split(row[1]).join(other.receipt.receipt_hash)}\n${row[0]}`);
  }],
  ['731-AC-1', 'a group with one receipt shown', (h) => h.replace(/(<section class="drift-dates"[\s\S]*?<ol class="dates-rows">\n<li class="dates-row"[\s\S]*?<\/li>)[\s\S]*?(<\/ol>)/, '$1\n$2')],
  ['731-AC-1', 'a group removed', (h) => h.replace(/<section class="drift-dates"[\s\S]*?<\/section>\n/, '')],
  ['731-AC-1', 'a same-day-only group listed', (h) => withGroup(h, sameDayGroup())],
  ['731-AC-1', 'a placebo receipt paired with a two-arm one', (h) => withGroup(h, mixedArmsGroup())],
  ['731-AC-2', 'a date typed by hand', (h) => h.replace(/(<li class="dates-row"[^>]*>[\s\S]*?<span data-date>)(\d{4})/, (m, a, y) => `${a}${Number(y) - 1}`)],
  ['731-AC-2', 'a band typed by hand', (h) => h.replace(/(data-at="results\.aggregates\.with_skill\.mean_score">)([^<]*)(<\/data>)/, '$10.999$3')],
  ['731-AC-2', 'a bound value changed', (h) => h.replace(/<data value="([^"]*)"( data-src="[^"]*" data-at="results\.aggregates\.baseline\.stddev">)/, '<data value="0.000001"$2')],
  ['731-AC-2', 'two rows\' links swapped', (h) => {
    // Inside the first dates group, so the model lists' own links (spec 639 AC-6) stay as they are.
    const section = /<section class="drift-dates"[\s\S]*?<\/section>/.exec(h)[0];
    const rows = [...section.matchAll(/<li class="dates-row" data-receipt="([^"]*)">/g)].map((m) => m[1]);
    const swapped = section.replace(`<a href="/r/${rows[0]}/">`, '<a href="@L@">').replace(`<a href="/r/${rows[1]}/">`, `<a href="/r/${rows[0]}/">`).replace('<a href="@L@">', `<a href="/r/${rows[1]}/">`);
    return h.replace(section, swapped);
  }],
  ['731-AC-2', 'a harness typed by hand', (h) => (/data-at="run\.harness\.version">/.test(h) ? h.replace(/(data-at="run\.harness\.version">)[^<]*/, '$19.9.9') : h.replace(D.harnessNone, 'harness x 9.9.9'))],
  ['731-AC-3', 'one word of a pair line changed', (h) => h.replace(/(<span data-headline>)([^<]*)/, (m, a, t) => `${a}${t.replace(/[A-Za-z]+/, 'altered')}`)],
  ['731-AC-3', 'a pair line removed', (h) => h.replace(/<li class="dates-pair"[\s\S]*?<\/li>\n/, '')],
  ['731-AC-3', 'a pair line added', (h) => h.replace(/(<li class="dates-pair"[\s\S]*?<\/li>\n)/, '$1$1')],
  ['731-AC-3', 'a pair line\'s refusal attribute removed or added', (h) => (/ data-refusal="/.test(h) ? h.replace(/ data-refusal="[^"]*"/, '') : h.replace('<li class="dates-pair"', '<li class="dates-pair" data-refusal="baseline_did_not_reproduce"'))],
  // A-731-2: the plain label, and a refused pair's task and figures.
  ['731-AC-3', 'a plain label that is not the mapping\'s', (h) => h.replace(/<b data-plain>[\s\S]*?<\/b>/, '<b data-plain>A change detected</b>')],
  ['731-AC-3', 'a refused pair without its task id', (h) => h.replace(/(<span data-refused>on the task )<data\b[^>]*>[^<]*<\/data>/, '$1this one')],
  ['731-AC-3', 'a refused pair\'s average moved', (h) => h.replace(/(<span data-refused>[\s\S]*?averaged )<data value="[^"]*"/, '$1<data value="0.111111"')],
  ['731-AC-3', 'a refused pair naming only its first task', (h) => h.replace(/ The same held on [\s\S]*?\. No verdict is asserted/, ' No verdict is asserted')],
  ['731-AC-7', 'a raw differ label on the dates list', (h) => h.replace(/<b data-plain>[\s\S]*?<\/b>/, '<b data-plain>DRIFT</b>')],
  ['731-AC-7', 'a refused pair saying "this run"', (h) => h.replace('in the second, and their bands', 'in this run, and their bands')],
  ['731-AC-7', 'a refused pair saying "baseline arm"', (h) => h.replace('the scores without the skill averaged', 'the baseline arm averaged')],
  // A-731-3: most refused pairs rest on a receipt holding one answer per task, scored several times.
  ['731-AC-3', 'a refused pair saying "the answers averaged"', (h) => h.replace('the scores without the skill averaged', 'the answers without the skill averaged')],
  ['731-AC-6', 'the key saying "the answers" did not reproduce', (h) => h.replace('where the scores without the skill did not reproduce', 'where the answers without the skill did not reproduce')],
  ['731-AC-6', '"all moved" in the key', (h) => h.replace('any of these could have moved', 'all moved')],
  ['731-AC-6', 'Driftproof\'s own version left out of the key', (h) => h.replace('Driftproof\'s own version and scoring code, ', '')],
  ['731-AC-6', 'a word of the mapping changed', (h) => h.replace(/(<li data-differ-label="DRIFT">)[\s\S]*?<\/li>/, '$1A change, downward</li>')],
  ['731-AC-4', 'two rows swapped', (h) => {
    const rows = [...h.matchAll(/<li class="dates-row"[\s\S]*?<\/li>/g)].map((m) => m[0]);
    return h.replace(rows[0], '@R0@').replace(rows[1], rows[0]).replace('@R0@', rows[1]);
  }],
  ['731-AC-6', 'a key sentence removed', (h) => h.replace(/<p class="dates-key" data-dates-key="3">[\s\S]*?<\/p>\n/, '')],
  ['731-AC-6', 'a key sentence reworded', (h) => h.replace('never attributed', 'attributed to the model')],
  ['731-AC-6', 'a group\'s judge sentence contradicting its receipts', (h) => h.replace(/<span data-judge="(same|other)">[^<]*<\/span>/, (m, k) => `<span data-judge="${k === 'same' ? 'other' : 'same'}">${k === 'same' ? D.judge.other : D.judge.same}</span>`)],
  ['731-AC-7', 'the direction word "worse" on the page', (h) => h.replace('<p class="dates-how">', '<p class="dates-how">The model got worse. ')],
  ['731-AC-7', 'a numeral typed into a setup paragraph', (h) => h.replace('<p class="dates-setup">', '<p class="dates-setup">Run 3 of 3. ')],
  ['731-AC-7', 'a refusal key written into the text', (h) => h.replace('<p class="dates-setup">', '<p class="dates-setup">Refused as baseline_did_not_reproduce. ')],
  ['731-AC-8', 'the dates heading removed', (h) => h.replace(`<h2>${D.heading}</h2>\n`, '')],
];
// Two groups can be swapped only where the receipts form two.
if (expectedDates(ctx().entries, reportsOfArchive).length >= 2) {
  plants.push(['731-AC-4', 'two groups swapped', (h) => {
    const gs = [...h.matchAll(/<section class="drift-dates"[\s\S]*?<\/section>/g)].map((m) => m[0]);
    return h.replace(gs[0], '@G0@').replace(gs[1], gs[0]).replace('@G0@', gs[1]);
  }]);
}
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
// Spec 731 AC-5: the builder validates every receipt, so a fixture carries only fields its schema admits.
// A current-schema text receipt for the fields 0.6 lacks (timeout, code revision); a repository receipt,
// the one kind that seals a judge relationship; a 0.5 receipt, which records no judge template.
const base16 = () => clone(JSON.parse(read('receipts/report-017c/campaign-1/9edec01658bd1dd3181739e2133b892dd7036c5bb275aba29f8e3a2cfbcf529a.json')));
const base15 = () => clone(JSON.parse(read('receipts/report-016/receipt-15f01115639f.json')));
const base05 = () => clone(JSON.parse(read('receipts/report-007-rerun/writing-plans-claude-fable-5-2026-08-31.json')));
const { repositoryJudgeRelationship } = require('../lib/receipt');
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

test('A-639-8 a receipt no report lists leaves the rows only, and its seal is still read', () => {
  const { driftRows, driftMain } = builder();
  const a = base(), b = other();
  const unlisted = (hash) => ({ ...quiet, reportsOf: (r) => (r.receipt_hash === hash ? [] : ['014']) });
  const html = driftMain([fx('a', a), fx('b', b)], unlisted(a.receipt_hash));
  assert.ok(!html.includes(`data-receipt="${a.receipt_hash}"`), 'no row reads it');
  assert.ok(driftMain([{ ...fx('a', a), rel: 'receipts/canary/2026-11-08/a.json' }, fx('b', b)], unlisted(a.receipt_hash)).includes(`data-receipt="${a.receipt_hash}"`), 'plant: a canary receipt, which A-639-5 places, keeps its row');
  assert.throws(() => driftRows([fx('a', a), fx('b', b)], unlisted(a.receipt_hash)), /report/i, 'handed straight to the rows it is still refused (AC-7)');
  const edited = base(); edited.comparison.with_skill_score = 0.123456;
  assert.throws(() => driftMain([fx('a', edited), fx('b', b)], unlisted(edited.receipt_hash)), /seal|verif/i, 'plant: an unsealed receipt no report lists is refused');
});

// Spec 731's dates list arrives with dev. This row reads it from the moment the merge brings it in.
test('A-639-8 plant: every published receipt reaches the dates list, so commit-message-conventions stays listed', { skip: typeof builder().datesGroups === 'function' ? false : 'the dates list is not on this branch until dev is merged' }, () => {
  const { datesGroups, driftMain } = builder();
  const all = publishedReceipts();
  const names = (entries) => datesGroups(entries, { reportsOf: reportsOfArchive }).map((g) => g.name);
  assert.ok(names(all).includes('commit-message-conventions'), 'the group is listed from every published receipt');
  assert.ok(!names(all.filter((x) => reportsOfArchive(x.receipt).length > 0)).includes('commit-message-conventions'), 'plant: a filter ahead of the dates list would drop it');
  assert.match(driftMain(), /<section class="drift-dates"[^>]*>\n<h3 data-subject-name>commit-message-conventions<\/h3>/, 'the page lists it');
});

test('AC-8 each group moves alone, a judge counts as recorded on its rows, and self-grading reads different', async () => {
  const { driftRows, driftMain } = builder();
  const groups = (entries) => driftRows(entries, quiet)[0].conditions;
  const a = base();
  const pair = (edit, edit0 = () => {}, from = a, target = 'claude-sonnet-5-5') => { const a0 = clone(from); edit0(a0); return [fx('a', sealReceipt(a0)), fx('a2', onModel(from, target, (c) => { edit0(c); edit(c); }))]; };
  const same = { tasks: 'same', grading: 'same', setup: 'same' };
  assert.deepEqual(groups(pair(() => {})), same);
  assert.deepEqual(groups(pair((c) => { c.suite.suite_hash = 'd'.repeat(64); })), { ...same, tasks: 'differ' });
  assert.deepEqual(groups(pair((c) => { c.run.runner_version = '9.9.9'; })), { ...same, setup: 'differ' });
  assert.deepEqual(groups(pair((c) => { c.results.cases[0].judge.rubric_hash = 'c'.repeat(64); })), { ...same, grading: 'differ' });
  // The TBD-2 fields on a receipt whose schema admits them (A-639-4: the builder validates).
  const a16 = base16();
  assert.deepEqual(groups(pair(() => {}, () => {}, a16, 'claude-opus-5-5')), same);
  assert.deepEqual(groups(pair((c) => { c.run.timeout_ms = 1; }, () => {}, a16, 'claude-opus-5-5')), { ...same, setup: 'differ' }, 'a TBD-2 setup field');
  assert.deepEqual(groups(pair((c) => { c.run.judge.code_revision = 'judge-code-x'; }, () => {}, a16, 'claude-opus-5-5')), { ...same, grading: 'differ' }, 'a TBD-2 grading field');
  // M2: a receipt whose judge has no model id is invalid under every schema, so the builder refuses it
  // (spec 731 AC-5); a receipt that records no judge template (0.5) reads unrecorded.
  assert.throws(() => groups(pair(() => {}, (c) => { delete c.run.judge.model_id; })), /valid/i);
  const a05 = base05();
  assert.deepEqual(groups([fx('a', a05), fx('a2', onModel(a05, 'claude-sonnet-5-5'))]), { ...same, grading: 'unrecorded' });
  // M1: the judge is the answering model in one receipt only, computed, or sealed in scope on a
  // repository receipt, the one kind whose schema admits a relationship (A-639-4).
  assert.deepEqual(groups([fx('a', a), fx('a2', onModel(a, a.run.judge.model_id))]), { ...same, grading: 'differ' });
  const a15 = base15();
  assert.equal(a15.run.judge.relationship.same_model, false);
  assert.deepEqual(groups([fx('a', a15), fx('a2', onModel(a15, a15.run.judge.model_id, (c) => { c.run.judge.relationship = repositoryJudgeRelationship(c.run.model_id, c.run.judge.model_id); }))]), { ...same, grading: 'differ' });
  // A field compared where present: one receipt records the suite case and the other does not.
  assert.deepEqual(groups(pair((c) => { for (const x of c.results.cases) x.generation = { ...(x.generation || {}), suite_case: { prompt_hash: 'p', grading_hash: 'g' } }; })), same);
  for (const entries of [pair(() => {}), pair((c) => { c.suite.suite_hash = 'd'.repeat(64); }), [fx('a', a05), fx('a2', onModel(a05, 'claude-sonnet-5-5'))]]) {
    assert.deepEqual(await checkPage(driftMain(entries, quiet), { entries, pages: false, ...quiet }), []);
  }
  assert.ok(driftMain(pair((c) => { c.suite.suite_hash = 'd'.repeat(64); }), quiet).includes('The receipt from <span data-place>Report 014</span> on <span data-model-name>Claude Sonnet 5.5</span> records different test tasks.'));
});

test('AC-8 a grading difference is said by the field that moved', async () => {
  const { driftMain } = builder();
  const a = base(); const a16 = base16();
  const named = (who) => `The receipt from <span data-place>Report 014</span> on <span data-model-name>${who}</span>`;
  const cases = [
    ['self', [fx('a', a), fx('a2', onModel(a, a.run.judge.model_id))], `${named(humanModelName(a.run.judge.model_id))} was scored by the same model that answered it.`],
    ['model', [fx('a', a), fx('a2', onModel(a, 'claude-sonnet-5-5', (c) => { c.run.judge.model_id = 'claude-sonnet-5'; for (const x of c.results.cases) x.judge.model_id = 'claude-sonnet-5'; }))], `${named('Claude Sonnet 5.5')} was scored by a different model.`],
    // The code revision is a field of the current schema, so its fixture is a current receipt (A-639-4).
    ['code', [fx('a', a16), fx('a2', onModel(a16, 'claude-opus-5-5', (c) => { c.run.judge.code_revision = 'judge-code-x'; }))], `${named('Claude Opus 5.5')} was scored by a different version of the scoring code.`],
    ['other', [fx('a', a), fx('a2', onModel(a, 'claude-sonnet-5-5', (c) => { c.results.cases[0].judge.rubric_hash = 'c'.repeat(64); }))], `${named('Claude Sonnet 5.5')} records different grading instructions or settings.`],
  ];
  for (const [kind, entries, sentence] of cases) {
    const html = driftMain(entries, quiet);
    assert.ok(html.includes(sentence), `${kind}: ${sentence}`);
    for (const k of ['self', 'model', 'code', 'other']) if (k !== kind) assert.ok(!html.includes(T.scored[k][0]), `${kind} is not said as ${k}`);
    assert.deepEqual(await checkPage(html, { entries, pages: false, ...quiet }), [], kind);
  }
});

// ── spec 731: the dates groups on sealed fixtures ────────────────────────────────────────────────
// A second receipt of one setup on a later day; one byte of its suite hash flipped.
const later = (r, edit = () => {}) => { const c = clone(r); c.run.date_utc = '2026-10-08T10:00:00.000Z'; edit(c); return sealReceipt(c); };
const flipHash = (s) => s.slice(0, -1) + (s.endsWith('0') ? '1' : '0');

test('731 AC-1 a group is two or more receipts of one key: one byte of the suite hash, another judge, or a receipt alone forms none', () => {
  const { datesGroups } = builder();
  const a = base();
  const two = datesGroups([fx('a', a), fx('b', later(a))], quiet);
  assert.equal(two.length, 1);
  assert.deepEqual(two[0].xs.map((x) => x.rel), ['receipts/fixture-639/a.json', 'receipts/fixture-639/b.json']);
  assert.deepEqual(datesGroups([fx('a', a), fx('c', later(a, (c) => { c.suite.suite_hash = flipHash(c.suite.suite_hash); }))], quiet), [], 'plant: one byte of the suite hash forms no group');
  assert.deepEqual(datesGroups([fx('a', a)], quiet), [], 'a receipt alone forms no group');
  // A-731-1: a judge removed is refused by the schema, so the public path reaches a different judge.
  // A failed comparison reports counts here, never the groups: a group holds whole receipts.
  assert.equal(datesGroups([fx('a', a), fx('d', later(a, (c) => { c.run.judge.model_id = 'claude-sonnet-5'; for (const x of c.results.cases) x.judge.model_id = 'claude-sonnet-5'; }))], quiet).length, 0, 'plant: a different judge model forms no group');
  // The capture is a field of the current schema, so its fixture is a current receipt (the builder validates).
  const a16 = base16();
  assert.equal(datesGroups([fx('a', a16), fx('e', later(a16, (c) => { c.run.capture = { ...c.run.capture, mode: 'files' }; delete c.results.fake_tool_calls; }))], quiet).length, 0, 'a different capture forms no group');
  assert.deepEqual(datesGroups([fx('a', a), fx('f', onModel(a, 'claude-sonnet-5-5'))], quiet), [], 'another model forms no group');
  assert.equal(datesGroups([fx('a', a), fx('g', later(a, (c) => { c.run.model_id = `${c.run.model_id}-20260101`; }))], quiet).length, 1, 'a dated id of the same model is the same model');
});

test('731 AC-1 a group needs two distinct dates: same-day receipts form none, and a third on another date joins them (A-731-1)', () => {
  const { datesGroups } = builder();
  const a = base();
  const sameDay = later(a, (c) => { c.run.date_utc = a.run.date_utc.replace(/T.*/, 'T23:59:59.000Z'); });
  assert.equal(day(fx('s', sameDay)), day(fx('a', a)), 'the fixture shares the date');
  assert.notEqual(sameDay.run.date_utc, a.run.date_utc, 'the fixture is a separate receipt on that date');
  assert.equal(datesGroups([fx('a', a), fx('s', sameDay)], quiet).length, 0, 'plant: a same-day-only group is not listed');
  const three = datesGroups([fx('a', a), fx('s', sameDay), fx('b', later(a))], quiet);
  assert.equal(three.length, 1, 'a group that spans dates is listed');
  assert.deepEqual(three[0].xs.map((x) => x.rel), ['a', 's', 'b'].map((n) => `receipts/fixture-639/${n}.json`), 'it keeps both receipts of the shared date');
  assert.equal(three[0].pairs.length, 2);
  const entries = [fx('a', a), fx('s', sameDay), fx('b', later(a))];
  assert.deepEqual(expectedDates(entries, () => ['014']).map((g) => g.xs.length), [3], 'the oracle reads the same rule');
  assert.equal(expectedDates(entries.slice(0, 2), () => ['014']).length, 0, 'the oracle lists no same-day group');
});

test('731 AC-1 a placebo-arm receipt is never paired with a two-arm one, and matching arms still group (A-731-1)', () => {
  const { datesGroups } = builder();
  // The real pair the page used to show: one key but for the arms, on two dates.
  const [, xs] = mixedArmsGroup();
  const placebo = xs.find((x) => armSet(x.receipt).includes('placebo'));
  const twoArm = xs.find((x) => !armSet(x.receipt).includes('placebo'));
  assert.ok(placebo && twoArm, 'the archive holds a placebo receipt beside a two-arm one');
  assert.equal(withoutArms(placebo.receipt), withoutArms(twoArm.receipt), 'the two differ only in the arm set');
  assert.notEqual(day(placebo), day(twoArm), 'and they are on two dates');
  assert.equal(datesGroups([placebo, twoArm], quiet).length, 0, 'plant: a placebo receipt paired with a two-arm one forms no group');
  assert.equal(expectedDates([placebo, twoArm], () => ['014']).length, 0, 'the oracle keeps them apart');
  // Control: the arm set separates only what differs in it.
  const a16 = base16();
  assert.ok(armSet(a16).includes('placebo'), 'the fixture has a placebo arm');
  assert.equal(datesGroups([fx('p', a16), fx('q', later(a16))], quiet).length, 1, 'two placebo-arm receipts on two dates form a group');
});

test('731 AC-3 a label outside the mapping and a refusal with no fixed words each refuse the build (A-731-2)', () => {
  const { labelOfHeadline, refusedTasks } = builder();
  assert.deepEqual(labelOfHeadline('DRIFT: some words.'), { label: 'DRIFT', plain: 'A separation detected, downward', rest: 'some words.' });
  assert.throws(() => labelOfHeadline('WOBBLED: some words.'), /label/, 'plant: a new differ label reaching the page unmapped');
  const a = fx('a', base()), b = fx('b', later(base()));
  assert.throws(() => refusedTasks(a, b, 'baseline_missing'), /fixed words/, 'plant: a refusal in the differ\'s own jargon');
});

test('731 AC-3 and AC-6 the fixture pair renders the differ\'s words after its label, bound to both receipts, and the oracle reads it GREEN', async () => {
  const { driftMain } = builder();
  const a = base(); const b = later(a);
  const entries = [fx('a', a), fx('b', b)];
  const html = driftMain(entries, quiet);
  const want = headlineOf(entries[0], entries[1]);
  assert.ok(want.text && want.text.length > 20, 'the fixture pair has a headline');
  assert.ok(html.includes(`<b data-plain>${want.plain}</b>`), 'the label is in its plain words');
  assert.ok(html.includes(`<span data-headline>${want.rest.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')}</span>`), 'the words after the label are on the page verbatim');
  assert.ok(html.includes(`data-src="receipts/fixture-639/a.json receipts/fixture-639/b.json" data-fn="${D.fn}"`));
  assert.deepEqual(await checkPage(html, { entries, pages: false, ...quiet }), []);
  // The same receipt with the skill arm's scores moved by one draw refuses on the baseline check only when the versions differ; here the headline moves with the scores.
  const c = later(a, (x) => { for (const row of x.results.cases) if (row.mode === 'with_skill') { row.mean = Math.min(1, row.mean + 0.3); row.generation.mean = row.mean; } });
  const moved = driftMain([fx('a', a), fx('c', c)], quiet);
  assert.notEqual(/<span data-headline>([^<]*)<\/span>/.exec(moved)[1], want.rest, 'plant: a pair whose scores moved reads another headline');
});

test('731 AC-5 an edited receipt and an invalid one are refused before anything is rendered', () => {
  const { driftMain, driftRows } = builder();
  const a = base();
  const edited = later(a); edited.results.aggregates.with_skill.mean_score = 0.123456;
  assert.throws(() => driftMain([fx('a', a), fx('b', edited)], quiet), /seal|verif/i);
  const invalid = later(a, (c) => { c.schema_version = '9.9'; });
  assert.throws(() => driftMain([fx('a', a), fx('b', invalid)], quiet), /valid/i);
  assert.throws(() => driftRows([fx('a', a), fx('b', invalid)], quiet), /valid/i);
  // A-731-1: datesGroups is exported, so it refuses on its own path.
  const { datesGroups } = builder();
  assert.throws(() => datesGroups([fx('a', a), fx('b', invalid)], quiet), /valid/i, 'plant: datesGroups accepting a receipt of an unknown schema');
  const noJudge = later(a, (c) => { delete c.run.judge.model_id; for (const x of c.results.cases) delete x.judge.model_id; });
  assert.throws(() => datesGroups([fx('a', a), fx('b', noJudge)], quiet), /valid/i, 'plant: datesGroups accepting a receipt with no judge model');
  assert.throws(() => datesGroups([fx('a', a), fx('b', edited)], quiet), /seal|verif/i, 'plant: datesGroups accepting an edited receipt');
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
    assert.equal(await p.locator('section.drift-dates').count(), expectedDates(ctx().entries, reportsOfArchive).length, 'spec 731: every dates group is on the served page');
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
