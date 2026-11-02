// SPDX-License-Identifier: Apache-2.0
'use strict';
// scripts/model-drift-page.js: /across-models/, the same skill on different models (spec 639).
//
// One row per text (skill.content_hash) whose published receipts cover two or more models, each
// receipt's reading in the library's words (lib/plain.js plainOf, or Report 015 Amendment 1's label
// for a router), linked to its receipt page. A row with a verdict on two or more models goes in the
// first list and says which of its receipts do not record the same test tasks, grading or run setup;
// every other row goes in the second list. Nothing is combined, averaged or ranked: rows are in name
// order, and no figure the receipts carry is printed. scripts/build-site-pages.js wraps the <main>
// this writes in the site's shell; this module renders, it does not run, and calls no model.
const fs = require('fs');
const path = require('path');
const { plainOf, LABELS, KEY, LEDE_ORDER } = require('../lib/plain');
const { receiptVerdict, verdictFakeToolCallWarning, UNDERPOWERED_LINE, CASES_LINE } = require('../lib/verdict');
const { verifyReceiptHash } = require('../lib/receipt');
const { sha256Files } = require('../lib/canonical');
const { canonicalModelId } = require('../lib/usage');
const policy = require('../lib/report-015-publication');
const { humanModelName } = require('./model-names');
const { htmlToText } = require('./html-text.js');

const ROOT = path.join(__dirname, '..');
const REL = 'across-models/index.html';
const HREF = '/across-models/';
// The receipt pages' own module is read when asked: it loads the head builder, which loads this
// module's caller.
const receiptPages = () => require('./build-receipt-pages.js');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const listed = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const refuse = (msg) => { throw Object.assign(new Error(`across-models: ${msg}`), { code: 'MODEL_DRIFT_REFUSED' }); };

// ── the page texts (spec 639 § Page texts) ───────────────────────────────────────────────────────
const q = (s) => `“${LABELS[s]}”`;
const TEXT = {
  title: 'The same skill on different models | Driftproof',
  h1: 'The same skill on different models',
  lede: 'Driftproof measured some skills and instruction files on more than one model. Here is what each receipt read, model by model, linked to the receipt.',
  meaning: [
    `${q('PASSED')} means the answers with the skill scored clearly higher on at least one test task, and clearly lower on none.`,
    `${q('REGRESSED')} means they scored clearly lower on at least one test task, even if another task scored clearly higher.`,
    `${q('UNDERPOWERED')} means there were too few answers, or they varied too much, to call it either way; it does not mean the skill does nothing.`,
    'A skill that helped on one model is not a guarantee that it helps on another.',
  ].join(' '),
  caution: 'Readings of one text on one model can differ between runs, so two different readings on two models do not show that the model made the difference.',
  how: [
    "A receipt is the record of one test run, with the skill and without it, sealed so that a changed file no longer matches its seal. Each reading is one receipt's, and links to that receipt's page. Where one model has more than one receipt, each is listed on its own. Nothing here is combined, averaged or ranked.",
    `The first list holds each skill or file with a reading that carries a verdict on at least two models. The second list holds each one measured on two or more models without that: each row there has a verdict on at most one model, and each receipt page without a verdict says why. Here a verdict is any reading from ${LABELS.PASSED} to ${LABELS.UNDERPOWERED_CASES}. Skills and files measured on only one model are not listed.`,
    'Each row in the first list says whether its receipts record the same test tasks, the same judge and grading, and the same run setup, and names any receipt that does not. The test tasks are what each answer was asked to do. The judge and grading are the model that scored the answers, its instructions and the code that ran it; the judge counts as different when it is the model that answered in some receipts and not in others. The run setup is the versions of the tools that ran the test, how the skill was given to the model, and how many answers each task asked for.',
    null, // the names and makers paragraph, which links Report 002: see howNames()
    'The key at the end of this page gives the exact rule for each reading.',
  ],
  names: (link) => `An instruction file is named by the repository it came from, then its file name. Where a row includes models from more than one maker, it compares no makers: as ${link} says, it is not a model ranking.`,
  main: 'Skills and files with a verdict on two or more models',
  other: 'Measured on two or more models, without a verdict on two',
  key: 'What each reading means',
  version: (places) => `Driftproof measured more than one version of this text. This row is the version in ${places}.`,
  alone: 'These receipts were not all measured the same way, so read each one on its own.',
  handoff: 'This text only tells the model to call another skill with the Skill tool, so its receipts read that instruction, not the skill it names.',
  noun: { tasks: 'test tasks', grading: 'judge and grading', setup: 'run setup' },
  differs: { tasks: 'different test tasks', setup: 'a different run setup' },
  // What a grading difference is, by the field that moved (A-639-2): [one receipt, several].
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
  note: (rest) => (rest.length === 1 ? `${rest[0]} carries the same note on its page.` : `${listed(rest)} carry the same note on theirs.`),
};
const GROUPS = ['tasks', 'grading', 'setup'];
// The readings that carry a verdict, from "Clearly helped" to "Too few test tasks to tell" in the
// library's order, the comparison read as reliable (A-639-2: the gloss names that range).
const VERDICT = new Set(['PASSED', 'REGRESSED', 'NO_EFFECT', 'UNDERPOWERED', 'UNDERPOWERED_CASES']);
const SHEET = new Set(['NOT_MEASURED', 'PRE_ANSWERED_BY', 'REFUSED']);

// ── what a receipt reads, and where it sits ──────────────────────────────────────────────────────
function readingOf(r) {
  if (policy.routerLimit(r)) return { label: policy.LABEL, words: 'ROUTER' };
  const p = plainOf(r);
  if (verdictFakeToolCallWarning(r)) return { label: p.label, words: 'UNRELIABLE' };
  return { label: p.label, words: p.words || p.state };
}

// The reports whose published list carries a file with this receipt's hash (docs/data/reports.json).
let archiveIndex = null;
function reportsOfArchive(receipt) {
  if (!archiveIndex) {
    archiveIndex = new Map();
    for (const row of JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/data/reports.json'), 'utf8')).reports) {
      for (const p of row.receipt_paths || []) {
        let j; try { j = JSON.parse(fs.readFileSync(path.join(ROOT, p.value), 'utf8')); } catch { continue; }
        if (!archiveIndex.has(j.receipt_hash)) archiveIndex.set(j.receipt_hash, new Set());
        archiveIndex.get(j.receipt_hash).add(row.number.value);
      }
    }
  }
  return [...(archiveIndex.get(receipt.receipt_hash) || [])];
}
const reportsText = (ns) => (ns.length === 1 ? `Report ${ns[0]}` : `Reports ${listed(ns)}`);
function runOf(rel) {
  const run = /\/run-(\d+)\//.exec(rel);
  if (run) return `run ${run[1]}`;
  const word = /^receipts\/report-\d+-([a-z]+)\//.exec(rel);
  return word ? word[1] : null;
}

// ── AC-8: what the receipts record about how they were measured ─────────────────────────────────
const get = (o, p) => p.split('.').reduce((v, k) => (v === undefined || v === null ? undefined : v[k]), o);
const absent = (v) => v === undefined || v === null;
const orNull = (v) => (v === undefined ? null : v);
const armRows = (r) => ((r.results || {}).cases || []).filter((c) => c.mode === 'with_skill' || c.mode === 'baseline');
// The judge a receipt records: each arm row's own, or the run's where a row names none (spec 639 M2).
const caseJudge = (r, c) => get(c, 'judge.model_id') ?? get(r, 'run.judge.model_id');
// Whether the judge is the answering model. A sealed relationship is read where it is in scope; a
// receipt without one is read by the same rule lib/receipt.js seals it with.
function judgeIsModel(r, judges) {
  const rel = get(r, 'run.judge.relationship');
  if (rel && rel.comparison_scope === 'within-model' && typeof rel.same_model === 'boolean') return rel.same_model;
  return judges.some((j) => canonicalModelId(j) === canonicalModelId(r.run.model_id));
}
// A group's fields for one receipt: the required ones, the ones equal when absent from all, and the
// ones compared only among the receipts that record them.
function groupOf(r, g) {
  const rows = armRows(r);
  if (g === 'tasks') {
    return {
      required: [get(r, 'suite.suite_hash')],
      optional: [get(r, 'run.scope.task_ids'), get(r, 'run.scoring.freeze_hash')],
      present: rows.filter((c) => get(c, 'generation.suite_case')).map((c) => [c.id, c.mode, orNull(get(c, 'generation.suite_case.prompt_hash')), orNull(get(c, 'generation.suite_case.grading_hash'))]),
    };
  }
  if (g === 'grading') {
    const judges = rows.map((c) => caseJudge(r, c));
    const recorded = rows.length > 0 && judges.every((j) => !absent(j));
    return {
      required: [recorded ? true : null, ...['prompt_template_hash', 'samples', 'surface'].map((k) => get(r, `run.judge.${k}`)), ...rows.map((c) => get(c, 'judge.rubric_hash'))],
      optional: [get(r, 'run.judge.temperature'), get(r, 'run.judge.sampling'), get(r, 'run.judge.code_revision'), recorded ? judgeIsModel(r, judges) : null,
        [...new Set(rows.map((c, i) => JSON.stringify([c.id, c.mode, orNull(judges[i]), orNull(get(c, 'judge.rubric_hash'))])))].sort()],
      present: [],
    };
  }
  return {
    required: [get(r, 'run.runner_version'), get(r, 'run.surface')],
    optional: ['delivery', 'harness', 'judge.harness', 'capture.mode', 'capture.limits', 'timeout_ms', 'answered_by.kind', 'provider'].map((k) => get(r, `run.${k}`)),
    present: [],
    perRow: [...new Set(rows.map((c) => JSON.stringify([c.id, c.mode, orNull(get(c, 'generation.n_planned'))])))].sort(),
  };
}
const valueOf = (v) => JSON.stringify([v.required.map(orNull), v.optional.map(orNull), v.perRow || []]);
// A group across a row: its state, the receipts that do not record it, and the receipts that record
// a different value from the largest class (the earliest receipt's class where two are as large).
function groupAcross(xs, g) {
  const vs = xs.map((x) => ({ x, v: groupOf(x.receipt, g) }));
  const missing = vs.filter((e) => e.v.required.some(absent)).map((e) => e.x);
  const recorded = vs.filter((e) => !e.v.required.some(absent));
  const classes = new Map();
  for (const e of recorded) { const k = valueOf(e.v); if (!classes.has(k)) classes.set(k, []); classes.get(k).push(e.x); }
  // A field compared where present splits a class only where two receipts both record it.
  const present = new Map(recorded.map((e) => [e.x, e.v.present]));
  let parts = [...classes.values()];
  parts = parts.flatMap((part) => {
    const out = [];
    for (const x of part) {
      const p = present.get(x);
      const home = out.find((o) => o.every((y) => { const q2 = present.get(y); return !p.length || !q2.length || JSON.stringify(p) === JSON.stringify(q2); }));
      if (home) home.push(x); else out.push([x]);
    }
    return out;
  });
  let differ = [], ref = null;
  if (parts.length > 1) {
    const largest = [...parts].sort((a, b) => b.length - a.length || xs.indexOf(a[0]) - xs.indexOf(b[0]))[0];
    ref = largest[0];
    differ = xs.filter((x) => recorded.some((e) => e.x === x) && !largest.includes(x));
  }
  return { state: missing.length ? 'unrecorded' : differ.length ? 'differ' : 'same', missing, differ, ref };
}
// What a receipt's grading differs in from the reference receipt's, by field (A-639-2): it scored
// itself where the reference did not; another judge model; the scoring code alone; anything else.
function gradingParts(r) {
  const rows = armRows(r);
  const judges = rows.map((c) => caseJudge(r, c));
  return {
    models: JSON.stringify([...new Set(judges)].sort()),
    self: judgeIsModel(r, judges),
    code: orNull(get(r, 'run.judge.code_revision')),
    rest: JSON.stringify([...['prompt_template_hash', 'samples', 'surface', 'temperature', 'sampling'].map((k) => orNull(get(r, `run.judge.${k}`))), [...new Set(rows.map((c) => `${c.id}|${c.mode}|${get(c, 'judge.rubric_hash')}`))].sort()]),
  };
}
function gradingKind(x, ref) {
  const a = gradingParts(x.receipt), b = gradingParts(ref.receipt);
  if (a.self && !b.self) return 'self';
  if (a.models !== b.models) return 'model';
  if (a.rest === b.rest && a.code !== b.code) return 'code';
  return 'other';
}

// ── rows ──────────────────────────────────────────────────────────────────────────────────────────
// TODO(issue 642): this is the hand-off test until issue 642's shared rule lands; then call that one.
// A text is a hand-off when its body, after the front matter, is only instructions to call the Skill
// tool.
function isHandoff(text) {
  const body = String(text).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
  const lines = body.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return lines.length > 0 && lines.every((l) => /^Call the Skill tool\b/.test(l));
}
// The skill texts the repository commits, by the content hash a receipt seals for them.
const TEXT_DIRS = ['receipts/report-017-panel', 'specs/639-model-drift-page/texts'];
function committedTexts(root = ROOT) {
  const out = new Map();
  for (const d of TEXT_DIRS) {
    const dir = path.join(root, d);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.md')).sort()) {
      const bytes = fs.readFileSync(path.join(dir, f));
      out.set(sha256Files([{ path: 'SKILL.md', bytes }]), bytes.toString('utf8'));
    }
  }
  return out;
}
// The dated note a report page carries under its headline, read from the page.
const decode = (s) => s.replace(/&(amp|lt|gt|quot|#39|rsquo|ldquo|rdquo|middot);/g, (m, k) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", rsquo: '’', ldquo: '“', rdquo: '”', middot: '·' })[k]);
function reportNote(n, root = ROOT) {
  const f = path.join(root, 'docs/reports', n, 'index.html');
  if (!fs.existsSync(f)) return null;
  const m = /<p\b[^>]*\bid="interim-note"[^>]*>([\s\S]*?)<\/p>/.exec(fs.readFileSync(f, 'utf8'));
  // Issue 661 (CodeQL js/incomplete-multi-character-sanitization): the note's text by the tokenizer of
  // scripts/html-text.js, never a tag-stripping pattern; each entity decoded once, after the tags are gone.
  return m ? htmlToText(m[1], { skip: ['script', 'style'], decode, collapse: true }) : null;
}

function driftRows(entries, { reportsOf = reportsOfArchive, texts = committedTexts(), notes = reportNote } = {}) {
  const { subjectName } = receiptPages();
  const by = new Map();
  for (const x of entries) {
    if (!verifyReceiptHash(x.receipt)) refuse(`${x.rel}: receipt_hash does not verify; an unsealed receipt is not read`);
    const k = x.receipt.skill.content_hash;
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(x);
  }
  const rows = [];
  for (const [subject, all] of by) {
    const ids = [...new Set(all.map((x) => x.receipt.run.model_id))];
    if (ids.length < 2) continue;
    const xs = [...all].sort((a, b) => cmp(a.receipt.run.date_utc, b.receipt.run.date_utc) || cmp(a.rel, b.rel));
    const names = ids.map(humanModelName);
    if (new Set(names).size !== names.length) refuse(`${subject.slice(0, 12)}: two model ids share one name (${ids.join(', ')})`);
    const readings = new Map(xs.map((x) => {
      const ns = [...new Set(reportsOf(x.receipt))].sort();
      if (!ns.length) refuse(`${x.rel}: no report lists this receipt, so its place cannot be read`);
      const run = runOf(x.rel);
      return [x, { hash: x.receipt.receipt_hash, ...readingOf(x.receipt), reports: ns, place: reportsText(ns) + (run ? `, ${run}` : ''), date: String(x.receipt.run.date_utc).slice(0, 10) }];
    }));
    const models = ids.map((id) => ({ id, name: humanModelName(id), entries: xs.filter((x) => x.receipt.run.model_id === id) }))
      .sort((a, b) => cmp(a.entries[0].receipt.run.date_utc, b.entries[0].receipt.run.date_utc) || cmp(a.id, b.id))
      .map((m) => ({ ...m, readings: m.entries.map((x) => readings.get(x)) }));
    const verdictModels = models.filter((m) => m.readings.some((r) => VERDICT.has(r.words))).length;
    const reports = [...new Set(xs.flatMap((x) => readings.get(x).reports))].sort();
    const noteOf = new Map();
    for (const n of reports) { const t = notes(n); if (t) { if (!noteOf.has(t)) noteOf.set(t, []); noteOf.get(t).push(n); } }
    rows.push({
      subject, name: subjectName(xs[0].rel, xs[0].receipt), list: verdictModels >= 2 ? 'main' : 'other', xs, models, readings, reports,
      first: xs[0].receipt.run.date_utc, router: xs.some((x) => policy.routerLimit(x.receipt)),
      handoff: texts.has(subject) && isHandoff(texts.get(subject)),
      notes: [...noteOf].map(([text, ns]) => ({ text, reports: ns })),
      groups: Object.fromEntries(GROUPS.map((g) => [g, groupAcross(xs, g)])),
    });
  }
  const order = (a, b) => cmp(a.name.toLowerCase(), b.name.toLowerCase()) || cmp(a.first, b.first) || cmp(a.subject, b.subject);
  rows.sort((a, b) => cmp(a.list === 'main' ? 0 : 1, b.list === 'main' ? 0 : 1) || order(a, b));
  const count = new Map();
  for (const r of rows) count.set(r.name, (count.get(r.name) || 0) + 1);
  const seen = new Set();
  for (const r of rows) {
    r.versioned = count.get(r.name) > 1;
    const id = `${r.name}|${r.versioned ? reportsText(r.reports) : ''}`;
    if (seen.has(id)) refuse(`two rows named ${r.name} read the same; they cannot be told apart`);
    seen.add(id);
    r.conditions = Object.fromEntries(GROUPS.map((g) => [g, r.groups[g].state]));
  }
  return rows;
}

// ── rendering ─────────────────────────────────────────────────────────────────────────────────────
const place = (s) => `<span data-place>${esc(s)}</span>`;
const modelName = (s) => `<span data-model-name>${esc(s)}</span>`;
// The receipts a condition sentence names. By their reports where no other receipt of the row is in
// those reports; otherwise a place alone where every receipt at that place is named, and each other
// named receipt by its place and model, the items then parted by semicolons when one holds an "and".
function who(row, named) {
  const noun = named.length === 1 ? 'receipt' : 'receipts';
  const reports = [...new Set(named.flatMap((x) => row.readings.get(x).reports))].sort();
  const inThem = row.xs.filter((x) => row.readings.get(x).reports.some((n) => reports.includes(n)));
  if (inThem.every((x) => named.includes(x))) return `${noun} from ${place(reportsText(reports))}`;
  const items = [];
  for (const p of [...new Set(named.map((x) => row.readings.get(x).place))]) {
    const atPlace = row.xs.filter((x) => row.readings.get(x).place === p);
    const here = named.filter((x) => row.readings.get(x).place === p);
    if (here.length === atPlace.length) items.push(place(p));
    else for (const x of here) items.push(`${place(p)} on ${modelName(humanModelName(x.receipt.run.model_id))}`);
  }
  // Parted by semicolons, so a model attached to one item reads as that item's only (A-639-2).
  const join = items.length > 1 ? `${items.slice(0, -1).join('; ')}; and ${items[items.length - 1]}` : items[0];
  return `${noun} from ${join}`;
}
function conditionsHTML(row) {
  const out = [];
  for (const g of GROUPS) {
    const { state, missing, differ } = row.groups[g];
    if (state === 'same') { out.push(`Every receipt in this row records the same ${TEXT.noun[g]}.`); continue; }
    if (missing.length) out.push(`Not every receipt records its ${TEXT.noun[g]}: the ${who(row, missing)} ${missing.length === 1 ? 'does' : 'do'} not.`);
    if (!differ.length) continue;
    if (g !== 'grading') { out.push(`The ${who(row, differ)} ${differ.length === 1 ? 'records' : 'record'} ${TEXT.differs[g]}.`); continue; }
    for (const kind of Object.keys(TEXT.scored)) {
      const these = differ.filter((x) => gradingKind(x, row.groups[g].ref) === kind);
      if (these.length) out.push(`The ${who(row, these)} ${TEXT.scored[kind][these.length === 1 ? 0 : 1]}.`);
    }
  }
  if (GROUPS.some((g) => row.groups[g].state !== 'same')) out.push(TEXT.alone);
  return `<p class="drift-conditions">${out.join(' ')}</p>`;
}
function readingHTML(r) {
  return `<span class="drift-reading" data-receipt="${r.hash}"><a href="/r/${r.hash}/">${esc(r.label)}</a> (${place(r.place)}, <span data-date>${r.date}</span>)</span>`;
}
function rowHTML(row) {
  const L = [];
  const attrs = row.list === 'main' ? ` data-tasks="${row.conditions.tasks}" data-grading="${row.conditions.grading}" data-setup="${row.conditions.setup}"` : '';
  L.push(`<section class="drift-row" data-list="${row.list}" data-subject="${row.subject}"${attrs}>`);
  L.push(`<h3 data-subject-name>${esc(row.name)}</h3>`);
  if (row.list === 'main') L.push(conditionsHTML(row));
  if (row.router) L.push(`<p class="drift-router">${esc(policy.REASON)} <a href="${policy.AMENDMENT}">${place('Report 015 Amendment 1')}</a>.</p>`);
  if (row.versioned) L.push(`<p class="drift-version">${esc(TEXT.version('@'))}</p>`.replace('@', place(reportsText(row.reports))));
  if (row.handoff) L.push(`<p class="drift-handoff">${esc(TEXT.handoff)}</p>`);
  for (const m of row.models) L.push(`<p class="drift-model" data-model="${esc(m.id)}">On ${modelName(m.name)}: ${m.readings.map(readingHTML).join('; ')}.</p>`);
  // Each note is led in by its report, so its "this page" reads as that report's page (A-639-2).
  for (const n of row.notes) {
    const [first, ...rest] = n.reports.map((r) => `<a href="/reports/${r}/#interim-note">${place(`Report ${r}`)}</a>`);
    L.push(`<p class="drift-note">${first}'s note, on its own page: “<span data-note>${esc(n.text)}</span>”${rest.length ? ` ${TEXT.note(rest)}` : ''}</p>`);
  }
  L.push('</section>');
  return L.join('\n');
}

// The key: one entry per reading the page shows, in the library's order, the router's last.
function keyHTML(rows) {
  const { pageLabel } = receiptPages();
  const shown = new Map();
  for (const row of rows) for (const x of row.xs) { const w = row.readings.get(x).words; if (!shown.has(w)) shown.set(w, []); shown.get(w).push(x.receipt); }
  const order = [...LEDE_ORDER.filter((s) => shown.has(s)), ...['UNRELIABLE', 'ROUTER'].filter((s) => shown.has(s))];
  for (const s of shown.keys()) if (!order.includes(s)) refuse(`the reading ${s} has no entry in the key`);
  return order.map((s) => {
    if (s === 'ROUTER') {
      const page = [...new Set(shown.get(s).map((r) => policy.routerLimit(r).label))];
      if (page.length !== 1) refuse(`the router reading has ${page.length} receipt-page labels`);
      return `<p data-key="ROUTER"><b>${esc(policy.LABEL)}</b>: ${esc(policy.REASON)} <a href="${policy.AMENDMENT}">${place('Report 015 Amendment 1')}</a>. ${esc(`Its receipt page calls it “${page[0]}”. ${TEXT.router}`)}</p>`;
    }
    const page = [...new Set(shown.get(s).map((r) => pageLabel(receiptVerdict(r))))];
    if (page.length !== 1) refuse(`the reading ${s} has ${page.length} receipt-page labels`);
    const label = s === 'UNRELIABLE' ? plainOf(shown.get(s)[0]).label : LABELS[s];
    const meaning = s === 'UNRELIABLE' ? verdictFakeToolCallWarning(shown.get(s)[0]).replace(/^Comparison unreliable: /, '') : KEY[s];
    const adds = s === 'UNDERPOWERED' ? ` That page adds: ${UNDERPOWERED_LINE}. ${TEXT.draws}` : s === 'UNDERPOWERED_CASES' ? ` That page adds: ${CASES_LINE}. ${TEXT.draws}` : SHEET.has(s) ? ` ${TEXT.sheet}${s === 'PRE_ANSWERED_BY' ? ` ${TEXT.answeredBy}` : ''}` : '';
    return `<p data-key="${s}"><b>${esc(label)}</b>: ${esc(`${meaning} Its receipt page calls it “${page[0]}”.${adds}`)}</p>`;
  }).join('\n');
}

function driftMain(entries = receiptPages().receipts(), opts = {}) {
  const rows = driftRows(entries, opts);
  const main = rows.filter((r) => r.list === 'main');
  const other = rows.filter((r) => r.list === 'other');
  const how = TEXT.how.map((t) => (t === null
    ? `<p class="drift-how">${esc(TEXT.names('@'))}</p>`.replace('@', `<a href="/reports/002/">${place('Report 002')}</a>`)
    : `<p class="drift-how">${esc(t)}</p>`));
  return `<main class="prose drift-page">
<h1>${esc(TEXT.h1)}</h1>
<p class="lede">${esc(TEXT.lede)}</p>
<p class="drift-meaning">${esc(TEXT.meaning)}</p>
<p class="drift-caution">${esc(TEXT.caution)}</p>
${how.join('\n')}
<h2>${esc(TEXT.main)}</h2>
${main.map(rowHTML).join('\n')}
<h2>${esc(TEXT.other)}</h2>
${other.map(rowHTML).join('\n')}
<h2 id="key">${esc(TEXT.key)}</h2>
${keyHTML(rows)}
</main>`;
}

// THE PAGE AS PUBLISHED: build-site-pages.js's shell around driftMain, with the head builder's tags,
// so this file's own write and check produce the bytes the site builder does (A-639-2).
//   node scripts/model-drift-page.js                 write docs/across-models/index.html
//   node scripts/model-drift-page.js --check         exit 1 if it differs from a fresh render
//   ... [--docs DIR]                                 read or write DIR/across-models/index.html
function renderPage() {
  const { TARGETS } = require('./build-site-pages.js');
  return require('./build-head-tags.js').render(TARGETS[REL](), REL);
}
function main(argv) {
  let check = false, docs = path.join(ROOT, 'docs');
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--check') check = true;
    else if (argv[i] === '--docs' && argv[i + 1] && !argv[i + 1].startsWith('--')) docs = path.resolve(argv[++i]);
    else { console.error(`across-models: unknown argument ${JSON.stringify(argv[i])}`); return 2; }
  }
  const file = path.join(docs, REL);
  let html;
  try { html = renderPage(); } catch (e) { console.error(e.message); return 1; }
  if (check) {
    const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    if (current !== html) { console.error(`across-models: ${file} is ${current === null ? 'missing' : 'stale'} - run: node scripts/model-drift-page.js`); return 1; }
    console.log(`across-models: ${REL} matches a fresh render from the receipts`);
    return 0;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html);
  console.log(`across-models: ${REL} written`);
  return 0;
}

module.exports = { REL, HREF, TEXT, driftRows, driftMain, isHandoff, committedTexts, reportNote, reportsOfArchive, renderPage, main };
if (require.main === module) process.exitCode = main(process.argv.slice(2));
