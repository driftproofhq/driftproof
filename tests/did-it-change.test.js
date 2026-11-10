// SPDX-License-Identifier: Apache-2.0
'use strict';
// Spec 742: /did-it-change/, the same skills and the same tests on a later date, pair by pair. Every
// oracle here reads the manifest, the receipts it names, the suite files, the differ and the built page
// itself, never the builder's own list. Plants turn each criterion RED. Nothing here writes inside the
// tree: fixtures and screenshots go under TMPDIR (/var/tmp).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const Module = require('node:module');
const { spawnSync } = require('node:child_process');
const { buildDriftReport } = require('../lib/diff');
const { validateReceipt, verifyReceiptHash, sealReceipt, kindOf, deliveryOf, SCHEMA_FILES } = require('../lib/receipt');
const { canonicalModelId } = require('../lib/usage');
const { judgeSamplesOrNull } = require('../lib/counts');
const { suiteIdentity } = require('../lib/skill');
const { htmlToText, tokenize, attrOf } = require('../scripts/html-text.js');
const { humanModelName } = require('../scripts/model-names.js');

const ROOT = path.resolve(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const PAGE = 'did-it-change/index.html';
const STYLE = 'did-it-change/style.css';
const URL_PATH = '/did-it-change/';
const MANIFEST = 'receipts/canary/manifest.json';
const SOURCES = 'specs/408-skill-measurements/sources.json';
const SUITES = 'specs/408-skill-measurements/suites';
const scratch = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'did-it-change-742-'));
const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const json = (root, rel) => JSON.parse(read(root, rel));
const clone = (x) => JSON.parse(JSON.stringify(x));
const code = (c) => (e) => e.code === c;
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const and = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", '#x27': "'", rsquo: '’', ldquo: '“', rdquo: '”', middot: '·' };
const decode = (s) => String(s).replace(/&(amp|lt|gt|quot|#39|#x27|rsquo|ldquo|rdquo|middot);/g, (m, k) => ENT[k]);
const BLOCKS = ['h1', 'h2', 'h3', 'p', 'section', 'div', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'br', 'table', 'tr', 'td', 'th', 'header', 'footer', 'nav', 'details', 'summary'];
const textOf = (h) => htmlToText(h, { blockTags: BLOCKS, decode, collapse: true });
const attrs = (s) => Object.fromEntries([...s.matchAll(/\b(data-[a-z-]+|class|href|value)="([^"]*)"/g)].map((m) => [m[1], decode(m[2])]));

function builder() {
  const file = path.join(ROOT, 'scripts/build-did-it-change.js');
  assert.ok(fs.existsSync(file), 'scripts/build-did-it-change.js is not built yet');
  return require(file);
}

// ── the spec's own copy of the page texts (§ Page texts) ─────────────────────────────────────────
const T = {
  title: 'Did the AI change? | Driftproof',
  h1: 'Did the AI change?',
  lede: 'The same popular skills and the same tests, run again on the same model on a later date. Here is what Driftproof\'s comparison read for each pair.',
  what: [
    'People often say their AI assistant changed under them, and nobody can tell them whether it did. This page is a first reading of one way to find out. Driftproof keeps a receipt for every test it runs: the skill\'s exact text, the test tasks, the model, every score and a seal. Running the same skill and the same tests again on the same model on a later date gives a second receipt. Driftproof then compares the two with the same rule it uses for every comparison and says what it read.',
    'A canary is an early warning: a small, fixed check repeated over time, so that a change shows up as a difference between two readings of the same thing. Here the canary is a handful of popular skills, each with its own small set of text tasks, written by Driftproof and frozen before the first run.',
    'This page is not a status page, and it promises no schedule: we decide when to run it again. It is not a verdict about Claude or about any model. A difference between two dates is read under a fixed rule and is never attributed to a cause.',
    'How the skills were chosen:',
  ],
  setup: 'Every receipt below records the same skill text, the same test tasks and the same model, scored by the same judge model the same number of times per answer, with each answer recorded the same way.',
  judge: { same: 'The judge was the same model as the one measured.', other: 'The judge was a different model from the one measured.' },
  harnessNone: 'harness not recorded',
  notMeasured: 'not measured',
  noBand: 'no band',
  fn: 'lib/diff.js buildDriftReport release',
  key: [
    'A separation between two dates is detected under the rule, never attributed. Between the dates any of these could have moved the scores: the model behind the name, the harness that ran it, Driftproof\'s own version and scoring code, the judge model behind its name, the judge\'s own variation and chance. This page does not say which one made the difference.',
    'Where the judge is the same model as the one measured, a change in that model also changes the scoring, so the two cannot be told apart.',
    'No separation is not evidence of sameness: it means no test task separated under the rule at this sample size.',
    'Chance alone can produce a separation. Each task\'s band comes from a few answers, so the more tasks are read, the likelier one separates with nothing changed.',
    'No verdict is a result: where Driftproof refused to compare two receipts, or a receipt did not measure every task, or a separation did not hold for every score the lost answers could have had, it says so and asserts nothing.',
    'A few tasks per skill on a few dates is a first look, not a trend.',
    'In the rows, the harness is the program that ran the model. In the printed readings, a case is one test task, a band is the average plus or minus the usual spread of the scores, and the effect floor is the smallest gap that counts.',
    'Driftproof\'s comparison prints a label in capitals before each reading. This page writes that label in plain words and keeps the rest of the reading as printed. The labels and their plain words:',
  ],
  yours: [
    'In Claude Code, type /driftproof:recheck and the path to your file. The first use saves a copy of your file, its tests and its run settings and runs nothing. Each later use runs that saved copy and keeps another dated receipt, and a recheck compares each new result with the previous one and with the first saved reading. It cannot compare with a date before you saved.',
    'From a terminal, the same steps are driftproof recheck init --trusted-skill (only for a file you wrote yourself), driftproof recheck run --trusted-skill on each later date (you give that flag each time; the saved copy does not keep it) and driftproof recheck history for the comparisons.',
    'This checks Claude through Claude Code with fixed tasks, not anyone\'s chat history.',
    'Every pair of receipts this site holds for the same skill, the same tests, the same model, the same judge model and the same setup (how each answer was recorded and which sides of the comparison ran) on different dates is listed on The same skill on different models and dates.',
  ],
  caution: (n) => `Across these ${n} test tasks, chance alone can produce some separations under this rule, because each task's band comes from a few answers. This page does not say whether a separation here came from chance or from anything else.`,
  modelLine: 'A receipt names the model but cannot show whether what stands behind that name changed.',
  // A-742-2 (issue 765): each model's summary names Driftproof's own version and scoring code as a possible cause.
  summaryCauses: 'Driftproof\'s own version and scoring code could have moved these scores too, so a separation here cannot be put down to the model alone.',
  // A-742-2 (issue 765): what moved in each pair, in plain words.
  moved: {
    none: 'On no task did the answers with the skill score clearly higher or lower.',
    noVerdict: 'Nothing can be said about what moved in this pair.',
    task: (id, word, b, a) => `On the ${id} task, the answers with the skill scored ${word} on ${b} than on ${a}, by more than their usual spread.`,
    reconcile: 'The averages in the rows on either side cover all of this skill\'s tasks, so they can move the other way, and here they do.',
  },
};
// The fixed mapping (§ Page texts): the differ's label, its plain words, its reading.
const MAP = [
  ['NO SEPARATION DETECTED', 'No separation detected', 'none'],
  ['DRIFT', 'A separation detected on a task, with the skill lower on the later date', 'separation'],
  ['IMPROVED', 'A separation detected on a task, with the skill higher on the later date', 'separation'],
  ['MIXED', 'A separation detected, lower on some tasks and higher on others', 'separation'],
  ['INCONCLUSIVE', 'Inconclusive', 'no-verdict'],
  ['NOT MEASURED', 'Not measured', 'no-verdict'],
  ['REFUSED', 'Refused', 'no-verdict'],
];
const WORDS = ['none', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const W = (n) => (n < WORDS.length ? WORDS[n] : String(n));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const DIRECTION = /\bgot (?:better|worse)\b|\bworse\b|\bbetter\b|\bimproved\b|\bdegraded\b/i;
const INTERNAL = /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b|\b[a-z]+_[a-z_]+_[a-z_]+\b/;
const LABEL_WORDS = new RegExp(`\\b(?:${MAP.map(([l]) => l).join('|')})\\b`);
// A-742-2 (issue 765): what a selection rule written for a reader must not carry: a file path, a dotted field name, a digest's name.
const FIELD_OR_PATH = /[\w-]+\/[\w./-]*\.json\b|\b[a-z_]+\.[a-z_]+\b|\bsha256\b|\breceipts\//;
// A-742-2: the one flag the page's terminal commands use ahead of this branch's CLI. #755 declares it and lands before this
// page; it counts only while the CLI's usage text does not declare it, so the check is whole once #755 is in.
const PENDING_755 = { init: ['--trusted-skill'], run: ['--trusted-skill'] };
// What the CLI's usage text declares for one recheck action: its usage line and the lines that continue it.
function usageFlags(usage, action) {
  const lines = usage.split('\n');
  const at = lines.findIndex((l) => new RegExp(`^\\s*driftproof recheck ${action}\\b`).test(l));
  if (at < 0) return null;
  const block = [lines[at]];
  for (let i = at + 1; i < lines.length && /^\s+\[/.test(lines[i]); i++) block.push(lines[i]);
  return [...new Set([...block.join(' ').matchAll(/--[a-z][a-z-]*/g)].map((m) => m[0]))];
}
// The page's terminal commands, in page order, against that usage text.
function commandProblems(yoursHTML, usage, pending = {}) {
  const commands = [...yoursHTML.matchAll(/<code>(driftproof recheck [^<]*)<\/code>/g)].map((m) => m[1].split(/\s+/));
  const P = [];
  if (commands.map((c) => c[2]).join() !== 'init,run,history') P.push(`the commands run in the order ${commands.map((c) => c[2]).join(', ')}`);
  for (const c of commands) {
    const declared = usageFlags(usage, c[2]);
    if (declared === null) { P.push(`the CLI declares no recheck ${c[2]}`); continue; }
    for (const flag of c.slice(3)) if (!declared.includes(flag) && !(pending[c[2]] || []).includes(flag)) P.push(`recheck ${c[2]} uses ${flag}, which the CLI does not declare for it`);
  }
  const named = (a) => commands.find((c) => c[2] === a) || [];
  if (named('init').includes('--trusted-skill') && !named('run').includes('--trusted-skill')) P.push('a folder saved with --trusted-skill is run without it');
  return P;
}

// ── the oracle: the manifest, the receipts, the group key, the differ ────────────────────────────
const get = (o, p) => p.split('.').reduce((v, k) => (v === undefined || v === null ? undefined : v[k]), o);
const none = (v) => v === undefined || v === null;
const arms = (r) => ((r.results || {}).cases || []).filter((c) => c.mode === 'with_skill' || c.mode === 'baseline');
const VERSIONS = Object.keys(SCHEMA_FILES);
function captureOf(r) {
  const m = get(r, 'run.capture.mode');
  if (typeof m === 'string') return m;
  const at = VERSIONS.indexOf(r.schema_version);
  return at >= 0 && at < VERSIONS.indexOf('0.10') ? 'text' : null;
}
function judgesOf(r) {
  const rows = arms(r);
  const js = rows.map((c) => get(c, 'judge.model_id') ?? get(r, 'run.judge.model_id'));
  if (!rows.length || js.some(none)) return null;
  return [...new Set(js.map((j) => canonicalModelId(j)))].sort();
}
function groupKey(r) {
  const judges = judgesOf(r); const n = judgeSamplesOrNull(r); const c = captureOf(r);
  const k = kindOf(r).value; const d = deliveryOf(r).value;
  if (!judges || n === null || c === null || k === 'unknown' || d === 'unknown') return null;
  return JSON.stringify([r.skill.content_hash, r.suite.suite_hash, canonicalModelId(r.run.model_id), r.run.surface, judges, n, c, k, d]);
}
const judgeSelf = (r) => { const s = get(r, 'run.judge.relationship'); return s && s.comparison_scope === 'within-model' && typeof s.same_model === 'boolean' ? s.same_model : (judgesOf(r) || []).includes(canonicalModelId(r.run.model_id)); };
const day = (x) => String(x.receipt.run.date_utc).slice(0, 10);
const daysOf = (x) => Math.round(Date.parse(`${day(x)}T00:00:00Z`) / 86400000);
const n3 = (v) => Number(v).toFixed(3);
// The pair's headline, as spec 031 AC-3 reads it, split at its label.
function headlineOf(a, b) {
  const rep = buildDriftReport(a.receipt, b.receipt, { labelA: day(a), labelB: day(b), mode: 'release' });
  const ls = rep.markdown.split('\n'); const i = ls.findIndex((l) => /^## Headline\s*$/.test(l));
  const line = i < 0 ? '' : (ls.slice(i + 1).find((l) => l.trim()) || '');
  const text = line.trim().replace(/^\*\*/, '').replace(/\*\*$/, '');
  const m = /^([A-Z][A-Z ]*[A-Z])(?:: | — )([\s\S]*)$/.exec(text);
  const entry = m && MAP.find(([l]) => l === m[1]);
  return { text, label: m ? m[1] : null, rest: m ? m[2] : null, plain: entry ? entry[1] : null, reading: entry ? entry[2] : null, refusal: rep.refusal_key || null, perCase: rep.perCase };
}
const armText = (r, arm) => {
  if (r.run && r.run.status === 'incomplete') return T.notMeasured;
  const a = get(r, `results.aggregates.${arm}`) || {};
  if (typeof a.mean_score !== 'number') return T.notMeasured;
  return typeof a.stddev === 'number' ? `${n3(a.mean_score)} ± ${n3(a.stddev)}` : `${n3(a.mean_score)} ${T.noBand}`;
};
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
const harnessText = (r) => { const h = get(r, 'run.harness'); return h && typeof h.name === 'string' ? `harness ${h.name}${h.version !== undefined && h.version !== null ? ` ${h.version}` : ''}` : T.harnessNone; };
const rowText = (x) => `${day(x)}: Driftproof ${x.receipt.run.runner_version}, ${harnessText(x.receipt)}. With the skill ${armText(x.receipt, 'with_skill')}, without it ${armText(x.receipt, 'baseline')}.`;
// A-742-2 (issue 765): the tasks the differ separated, and what the pair line must say moved.
const separated = (l) => l.perCase.filter((c) => c.verdict === 'regression' || c.verdict === 'improvement');
function whatMoved(l) {
  if (l.reading === 'no-verdict') return T.moved.noVerdict;
  if (l.reading === 'none') return T.moved.none;
  const tasks = separated(l);
  // The averages as the rows print them, so the sentence never contradicts what a reader sees.
  const avg = (x) => Number(n3(get(x.receipt, 'results.aggregates.with_skill.mean_score')));
  const opposite = tasks.some((c) => (c.verdict === 'regression' ? avg(l.b) > avg(l.a) : avg(l.b) < avg(l.a)));
  return [...tasks.map((c) => T.moved.task(c.id, c.verdict === 'regression' ? 'lower' : 'higher', day(l.b), day(l.a))), ...(opposite ? [T.moved.reconcile] : [])].join(' ');
}
const pairText = (p) => `Comparing ${day(p.a)} with ${day(p.b)}: ${whatMoved(p)} Driftproof read: ${p.plain}: ${p.rest}`;
// A-742-1: what the two receipts of each pair record as different, and where one records nothing.
const MOVED_FIELDS = [['runner', 'run.runner_version'], ['code', 'run.judge.code_revision'], ['harness', 'run.harness.version']];
function movedOf(lines) {
  return Object.fromEntries(MOVED_FIELDS.map(([k, p]) => {
    const vals = lines.map((l) => [get(l.a.receipt, p), get(l.b.receipt, p)]);
    return [k, { differ: vals.filter(([x, y]) => !none(x) && !none(y) && x !== y).length, unrecorded: vals.filter(([x, y]) => none(x) || none(y)).length }];
  }));
}
const movedBit = (m) => `${W(m.differ)}${m.unrecorded ? ` (not recorded on ${W(m.unrecorded)})` : ''}`;
// A-742-2: the summary names Driftproof's version and scoring code only where a pair records them as different or does not record them.
const causesDue = (m) => m.runner.differ + m.code.differ + m.runner.unrecorded + m.code.unrecorded > 0;
const movedText = (n, m) => `Of the ${W(n)} pair${n === 1 ? '' : 's'} below, the receipts record a different version of Driftproof on ${movedBit(m.runner)}, a different revision of its scoring code on ${movedBit(m.code)} and a different version of the harness on ${movedBit(m.harness)}. ${T.modelLine}${causesDue(m) ? ` ${T.summaryCauses}` : ''}`;

// What the manifest and the receipts give: columns by model, skill lists in manifest order, rows by
// date, a pair line between each two adjacent rows, and the counts of the headline.
function expected(root) {
  const manifest = json(root, MANIFEST);
  const entries = new Map();
  const load = (rel) => { if (!entries.has(rel)) entries.set(rel, { rel, receipt: json(root, rel) }); return entries.get(rel); };
  const pairs = manifest.pairs.map((p) => ({ ...p, a: load(p.before), b: load(p.after) }));
  const byModel = new Map();
  for (const p of pairs) { const m = canonicalModelId(p.a.receipt.run.model_id); if (!byModel.has(m)) byModel.set(m, []); byModel.get(m).push(p); }
  const columns = [...byModel].map(([model, ps]) => {
    const skills = [];
    for (const p of ps) {
      const k = p.a.receipt.skill.content_hash;
      let s = skills.find((x) => x.subject === k);
      if (!s) { s = { subject: k, name: p.skill, repository: p.repository, commit: p.commit, suite: p.suite, suiteHash: p.a.receipt.suite.suite_hash, pairs: [] }; skills.push(s); }
      s.pairs.push(p);
    }
    for (const s of skills) {
      s.rows = [...new Set(s.pairs.flatMap((p) => [p.a, p.b]))].sort((x, y) => cmp(x.receipt.run.date_utc, y.receipt.run.date_utc) || cmp(x.rel, y.rel));
      s.lines = s.rows.slice(1).map((b, i) => { const a = s.rows[i]; return { a, b, named: s.pairs.some((p) => p.a === a && p.b === b), ...headlineOf(a, b) }; });
    }
    const rows = skills.flatMap((s) => s.rows);
    const lines = skills.flatMap((s) => s.lines);
    const dates = [...new Set(rows.map(day))].sort();
    const gaps = [...new Set(lines.map((l) => daysOf(l.b) - daysOf(l.a)))];
    const gap = gaps.length === 1 && gaps[0] >= 1 ? gaps[0] : null;
    const count = (reading) => lines.filter((l) => l.reading === reading).length;
    const separations = skills.flatMap((s) => s.lines.filter((l) => l.reading === 'separation').flatMap((l) => separated(l).map((c) => `${s.name}: on the ${c.id} task, the answers with the skill scored ${c.verdict === 'regression' ? 'lower' : 'higher'} on the later date`)));
    const name = humanModelName(model);
    const tasks = skills.reduce((n, s) => n + s.rows[0].receipt.suite.case_count, 0);
    const moved = movedOf(lines);
    // A-742-2 (issue 765): a clause of zero is left out; with no refused or unmeasured pair the headline says every pair got a reading.
    const clauses = [
      ...(count('none') ? [`no separation detected on ${W(count('none'))}`] : []),
      ...(count('separation') ? [`a separation detected on ${W(count('separation'))}${separations.length ? ` (${separations.join('; ')})` : ''}`] : []),
      ...(count('no-verdict') ? [`no verdict on ${W(count('no-verdict'))}`] : ['and every pair got a reading']),
    ];
    const headline = `${cap(W(skills.length))} popular skills, the same tests, ${and(dates)} on ${name}${gap !== null ? `, ${W(gap)} day${gap === 1 ? '' : 's'} apart` : ''}: ${clauses.join(', ')}.`;
    const selves = [...new Set(rows.map((x) => judgeSelf(x.receipt)))];
    return { model, name, skills, rows, lines, dates, gap, tasks, moved, counts: { skills: skills.length, none: count('none'), separation: count('separation'), 'no-verdict': count('no-verdict'), pairs: lines.length }, headline, judge: selves.length === 1 ? (selves[0] ? 'same' : 'other') : 'mixed', first: rows.map((x) => x.receipt.run.date_utc).sort()[0] };
  }).sort((a, b) => cmp(a.first, b.first) || cmp(a.model, b.model));
  return { manifest, columns, entries };
}

// ── reading the page ──────────────────────────────────────────────────────────────────────────────
const mainOf = (html) => { const m = /<main\b[^>]*>([\s\S]*?)<\/main>/.exec(html); return m ? m[1] : null; };
function columnsOf(main) {
  const starts = [...main.matchAll(/<section class="canary-model" data-model="([^"]*)">/g)];
  const end = main.indexOf('<h2 id="key">');
  return starts.map((m, i) => ({ model: m[1], body: main.slice(m.index + m[0].length, i + 1 < starts.length ? starts[i + 1].index : end) }));
}
const skillsOf = (body) => [...body.matchAll(/<section class="canary-skill" data-subject="([^"]*)" data-suite="([^"]*)">([\s\S]*?)<\/section>/g)].map((m) => ({ subject: m[1], suite: m[2], body: m[3] }));
const yoursOf = (main) => { const y = /<h2 id="yours">[\s\S]*?<\/h2>([\s\S]*)$/.exec(main); return y ? [...y[1].matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)].map((m) => m[1]) : []; };
const itemsOf = (body) => [...body.matchAll(/<li class="(canary-row|canary-pair)"([^>]*)>([\s\S]*?)<\/li>/g)].map((m) => ({ kind: m[1], a: attrs(m[2]), body: m[3] }));

// Every problem the page has against the manifest, the receipts and the differ, each tagged with its
// criterion. `pages` false skips the receipt-page existence check (fixtures).
function checkPage(html, { root = ROOT, pages = true } = {}) {
  const P = [];
  const main = mainOf(html);
  if (main === null) return ['AC-8 no <main>'];
  const exp = expected(root);
  const byHash = new Map([...exp.entries.values()].map((x) => [x.receipt.receipt_hash, x]));
  // AC-8: the words at the top.
  const h1 = [...main.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)];
  if (h1.length !== 1 || textOf(h1[0][1]) !== T.h1) P.push('AC-8 h1');
  const lede = /<p class="lede">([\s\S]*?)<\/p>/.exec(main);
  if (!lede || textOf(lede[1]) !== T.lede) P.push('AC-8 lede');
  const what = [...main.matchAll(/<p class="canary-what">([\s\S]*?)<\/p>/g)].map((m) => m[1]);
  if (what.length !== 4 || what.slice(0, 3).some((w, i) => textOf(w) !== T.what[i])) P.push('AC-8 the what-this-is paragraphs');
  const rule = /<q data-src="receipts\/canary\/manifest\.json" data-at="rule">([\s\S]*?)<\/q>/.exec(what[3] || '');
  if (!rule || textOf(rule[1]) !== exp.manifest.rule || textOf(what[3]) !== `${T.what[3]} ${exp.manifest.rule}`) P.push('AC-8 the rule is not the manifest\'s');
  // AC-15 (issue 765): the selection rule is written in plain words, and it is still the rule.
  if (rule) {
    const ruleText = textOf(rule[1]);
    const hit = FIELD_OR_PATH.exec(ruleText);
    if (hit) P.push(`AC-15 the selection rule carries a path or field name: ${hit[0]}`);
    if (root === ROOT) {
      const plan = json(root, 'receipts/report-018/plan.json');
      const routers = new Set(plan.routers.skills);
      const first = plan.execution.attempts.map((a) => a.protocol.skill).filter((s) => !routers.has(s)).slice(0, 5);
      let at = 0;
      if (!first.every((s) => { const i = ruleText.indexOf(s, at); if (i < 0) return false; at = i + s.length; return true; })) P.push('AC-15 the selection rule does not name the first five non-router skills in plan order');
      // The report the rule names is linked, and the link is that report's page.
      const report = /<a href="(\/reports\/(\d{3})\/)">Report (\d{3})<\/a>/.exec(rule[1]);
      if (!report || report[2] !== report[3] || !fs.existsSync(path.join(root, 'docs', report[1], 'index.html'))) P.push(`AC-15 the selection rule's report link: ${report ? report[1] : 'missing'}`);
    }
  }
  // AC-1: the columns and the skill lists.
  const got = columnsOf(main);
  if (JSON.stringify(got.map((c) => c.model)) !== JSON.stringify(exp.columns.map((c) => c.model))) P.push(`AC-1 columns ${got.map((c) => c.model).join(', ')} for ${exp.columns.map((c) => c.model).join(', ')}`);
  for (const g of got) {
    const e = exp.columns.find((c) => c.model === g.model);
    if (!e) continue;
    const name = /<h2>On <span data-model-name>([\s\S]*?)<\/span><\/h2>/.exec(g.body);
    if (!name || textOf(name[1]) !== e.name) P.push(`AC-1 column heading for ${g.model}`);
    // AC-5: the headline paragraph.
    const head = /<p class="canary-headline"([^>]*)>([\s\S]*?)<\/p>/.exec(g.body);
    if (!head) P.push(`AC-5 ${e.name}: no headline paragraph`);
    else {
      const a = attrs(head[1]);
      if (textOf(head[2]) !== e.headline) P.push(`AC-5 ${e.name}: headline reads ${JSON.stringify(textOf(head[2]))}`);
      for (const k of ['pairs', 'none', 'separation', 'no-verdict']) if (a[`data-${k}`] !== String(e.counts[k])) P.push(`AC-5 ${e.name}: data-${k} is ${a[`data-${k}`]}, the pair lines give ${e.counts[k]}`);
      const counts = [...head[2].matchAll(/<data value="([^"]*)" data-count="([^"]*)">([^<]*)<\/data>/g)].map((m) => [m[2], m[1], m[3]]);
      // A-742-2: a count of zero has no clause, and so no element; the paragraph's data attributes keep every count.
      const want = [['skills', String(e.counts.skills), cap(W(e.counts.skills))], ...(e.gap !== null ? [['days', String(e.gap), `${W(e.gap)} day${e.gap === 1 ? '' : 's'}`]] : []), ...['none', 'separation', 'no-verdict'].filter((k) => e.counts[k]).map((k) => [k, String(e.counts[k]), W(e.counts[k])])];
      if (JSON.stringify(counts) !== JSON.stringify(want)) P.push(`AC-5 ${e.name}: the count elements ${JSON.stringify(counts)}`);
      const dates = [...head[2].matchAll(/<span data-date>([^<]*)<\/span>/g)].map((m) => m[1]);
      if (JSON.stringify(dates) !== JSON.stringify(e.dates)) P.push(`AC-5 ${e.name}: the dates ${dates.join(', ')}`);
      // The counts are the page's own pair lines' readings, and nothing else.
      const shown = [...g.body.matchAll(/<li class="canary-pair"[^>]*\sdata-reading="([^"]*)"/g)].map((m) => m[1]);
      for (const k of ['none', 'separation', 'no-verdict']) if (a[`data-${k}`] !== String(shown.filter((r) => r === k).length)) P.push(`AC-5 ${e.name}: the headline counts ${a[`data-${k}`]} ${k}, the pair lines on the page carry ${shown.filter((r) => r === k).length}`);
      if (a['data-pairs'] !== String(shown.length)) P.push(`AC-5 ${e.name}: the headline counts ${a['data-pairs']} pairs, the page carries ${shown.length}`);
    }
    // AC-11: the caution, directly under the headline, its count the receipts'.
    const caution = /<p class="canary-caution">([\s\S]*?)<\/p>/.exec(g.body);
    if (!caution) P.push(`AC-11 ${e.name}: no caution`);
    else {
      if (textOf(caution[1]) !== T.caution(W(e.tasks))) P.push(`AC-11 ${e.name}: the caution reads ${JSON.stringify(textOf(caution[1]).slice(0, 100))}`);
      const c = /<data value="([^"]*)" data-count="tasks">([^<]*)<\/data>/.exec(caution[1]);
      if (!c || c[1] !== String(e.tasks) || c[2] !== W(e.tasks)) P.push(`AC-11 ${e.name}: the task count ${c ? c[1] : 'missing'}, the receipts give ${e.tasks}`);
      if (!(g.body.indexOf('canary-headline') < g.body.indexOf('canary-caution') && g.body.indexOf('canary-caution') < g.body.indexOf('canary-setup'))) P.push(`AC-11 ${e.name}: the caution is not under the headline`);
    }
    // AC-12: which recorded versions differ between the dates.
    const movedP = /<p class="canary-moved">([\s\S]*?)<\/p>/.exec(g.body);
    if (!movedP) P.push(`AC-12 ${e.name}: no recorded-versions line`);
    else {
      if (textOf(movedP[1]) !== movedText(e.counts.pairs, e.moved)) P.push(`AC-12 ${e.name}: the line reads ${JSON.stringify(textOf(movedP[1]).slice(0, 140))}`);
      const shown = [...movedP[1].matchAll(/<data value="([^"]*)" data-moved="([^"]*)">([^<]*)<\/data>/g)].map((m) => [m[2], m[1], m[3]]);
      const want = [['pairs', String(e.counts.pairs), W(e.counts.pairs)], ...MOVED_FIELDS.flatMap(([k]) => [[k, String(e.moved[k].differ), W(e.moved[k].differ)], ...(e.moved[k].unrecorded ? [[`${k}-unrecorded`, String(e.moved[k].unrecorded), W(e.moved[k].unrecorded)]] : [])])];
      if (JSON.stringify(shown) !== JSON.stringify(want)) P.push(`AC-12 ${e.name}: the counts ${JSON.stringify(shown)}`);
      // AC-14 (issue 765): each model's summary names Driftproof's own version and scoring code, as could have, never as moved.
      if (textOf(movedP[1]).includes(T.summaryCauses) !== causesDue(e.moved)) P.push(`AC-14 ${e.name}: the summary's sentence on Driftproof's own version and scoring code does not follow its counts`);
    }
    // AC-6: the setup paragraph and the judge sentence.
    const setup = /<p class="canary-setup">([\s\S]*?)<\/p>/.exec(g.body);
    const judge = /<span data-judge="([^"]*)">/.exec(g.body);
    if (e.judge === 'mixed') P.push(`AC-6 ${e.name}: the receipts disagree on whether the judge is the model; the builder must refuse`);
    else if (!setup || textOf(setup[1]) !== `${T.setup} ${T.judge[e.judge]}` || !judge || judge[1] !== e.judge) P.push(`AC-6 ${e.name}: setup paragraph ${setup ? JSON.stringify(textOf(setup[1]).slice(0, 80)) : 'missing'}`);
    const skills = skillsOf(g.body);
    if (JSON.stringify(skills.map((s) => s.subject)) !== JSON.stringify(e.skills.map((s) => s.subject))) P.push(`AC-1 ${e.name}: skill lists ${skills.map((s) => s.subject.slice(0, 8)).join(', ')} for ${e.skills.map((s) => s.subject.slice(0, 8)).join(', ')}`);
    for (const s of skills) {
      const es = e.skills.find((x) => x.subject === s.subject);
      if (!es) continue;
      if (s.suite !== es.suiteHash) P.push(`AC-1 ${es.name}: data-suite is not the receipts' suite hash`);
      const h3 = /<h3 data-skill-name>([\s\S]*?)<\/h3>/.exec(s.body);
      if (!h3 || textOf(h3[1]) !== es.name) P.push(`AC-1 ${es.name}: skill name`);
      const src = /<p class="canary-source" data-src="receipts\/canary\/manifest\.json">([\s\S]*?)<\/p>/.exec(s.body);
      const want = `From ${es.repository} at ${es.commit.slice(0, 8)}; the tests are ${path.basename(es.suite)}.`;
      if (!src || textOf(src[1]) !== want || !src[1].includes(`<span data-repository>${es.repository}</span>`) || !src[1].includes(`<code data-commit>${es.commit.slice(0, 8)}</code>`) || !src[1].includes(`<code data-suite-file>${path.basename(es.suite)}</code>`)) P.push(`AC-1 ${es.name}: source line ${src ? JSON.stringify(textOf(src[1])) : 'missing'}`);
      const items = itemsOf(s.body);
      const rows = items.filter((i) => i.kind === 'canary-row');
      const wantHashes = es.rows.map((x) => x.receipt.receipt_hash);
      if (JSON.stringify(rows.map((r) => r.a['data-receipt'])) !== JSON.stringify(wantHashes)) P.push(`AC-1 ${es.name}: rows ${rows.map((r) => String(r.a['data-receipt']).slice(0, 8)).join(', ')} for ${wantHashes.map((h) => h.slice(0, 8)).join(', ')}`);
      // Rows and pair lines alternate.
      if (items.map((i) => i.kind).join(',') !== es.rows.flatMap((x, i) => (i ? ['canary-pair', 'canary-row'] : ['canary-row'])).join(',')) P.push(`AC-4 ${es.name}: ${items.length} items for ${es.rows.length} rows`);
      // AC-3: each row is its receipt's.
      for (const r of rows) {
        const x = byHash.get(r.a['data-receipt']);
        if (!x) continue;
        const a = /<a href="([^"]*)"><span data-date>([^<]*)<\/span><\/a>/.exec(r.body);
        if (!a || a[1] !== `/r/${x.receipt.receipt_hash}/`) P.push(`AC-3 ${es.name}: row ${x.receipt.receipt_hash.slice(0, 8)} links ${a ? a[1] : 'nothing'}`);
        if (a && a[2] !== day(x)) P.push(`AC-3 ${es.name}: row ${x.receipt.receipt_hash.slice(0, 8)} date ${a[2]}`);
        if (pages && a) { const f = path.join(root, 'docs', a[1], 'index.html'); if (!fs.existsSync(f) || !fs.readFileSync(f, 'utf8').includes(x.receipt.receipt_hash)) P.push(`AC-3 ${a[1]} is not that receipt's page`); }
        const figs = [...r.body.matchAll(/<data value="([^"]*)" data-src="([^"]*)" data-at="([^"]*)">([^<]*)<\/data>/g)].map((m) => ({ value: decode(m[1]), src: decode(m[2]), at: m[3], text: decode(m[4]) }));
        const wantFigs = rowFigures(x.receipt).map((f) => ({ value: f.value, src: x.rel, at: f.at, text: f.text }));
        if (JSON.stringify(figs) !== JSON.stringify(wantFigs)) P.push(`AC-3 ${es.name}: row ${x.receipt.receipt_hash.slice(0, 8)} figures ${JSON.stringify(figs).slice(0, 160)}`);
        if ([...r.body.matchAll(/<data\b/g)].length !== figs.length) P.push(`AC-3 ${es.name}: a data element without its binding`);
        if (textOf(r.body) !== rowText(x)) P.push(`AC-3 ${es.name}: row text ${JSON.stringify(textOf(r.body).slice(0, 160))}`);
      }
      // AC-4: each pair line is the differ's headline under the mapping.
      const lines = items.filter((i) => i.kind === 'canary-pair');
      es.lines.forEach((l, i) => {
        const g2 = lines[i];
        if (!g2) return;
        if (!l.named) P.push(`AC-1 ${es.name}: rows ${day(l.a)} and ${day(l.b)} are adjacent but no manifest pair names them`);
        if (l.plain === null) { P.push(`AC-4 ${es.name}: the differ's label ${JSON.stringify(l.label)} is not in the mapping; the builder must refuse`); return; }
        if (g2.a['data-src'] !== `${l.a.rel} ${l.b.rel}` || g2.a['data-fn'] !== T.fn) P.push(`AC-4 ${es.name}: pair ${day(l.a)} to ${day(l.b)} is not bound to both receipts and the differ`);
        if (g2.a['data-headline'] !== l.text) P.push(`AC-4 ${es.name}: pair ${day(l.a)} to ${day(l.b)} data-headline ${JSON.stringify(String(g2.a['data-headline']).slice(0, 60))}`);
        if (g2.a['data-label'] !== l.label || g2.a['data-reading'] !== l.reading) P.push(`AC-4 ${es.name}: pair ${day(l.a)} to ${day(l.b)} label or reading`);
        if ((g2.a['data-refusal'] || null) !== l.refusal) P.push(`AC-4 ${es.name}: pair ${day(l.a)} to ${day(l.b)} refusal attribute ${g2.a['data-refusal'] || 'absent'}`);
        const plain = /<b data-plain>([^<]*)<\/b>/.exec(g2.body); const rest = /<span data-rest data-quote="text">([^<]*)<\/span>/.exec(g2.body);
        if (!plain || decode(plain[1]) !== l.plain) P.push(`AC-4 ${es.name}: pair ${day(l.a)} to ${day(l.b)} plain words ${plain ? plain[1] : 'missing'}`);
        if (!rest || decode(rest[1]) !== l.rest) P.push(`AC-4 ${es.name}: pair ${day(l.a)} to ${day(l.b)} rest ${JSON.stringify(rest ? decode(rest[1]).slice(0, 60) : 'missing')}`);
        if (textOf(g2.body) !== pairText(l)) P.push(`AC-4 ${es.name}: pair line text ${JSON.stringify(textOf(g2.body).slice(0, 120))}`);
        // AC-13 (issue 765): the line says what moved, in plain words, from the differ's per-case table, each date bound to its receipt.
        const moved = /<span data-what-moved="([^"]*)">([\s\S]*?)<\/span> Driftproof read:/.exec(g2.body);
        if (!moved) P.push(`AC-13 ${es.name}: pair ${day(l.a)} to ${day(l.b)} does not say what moved`);
        else {
          if (moved[1] !== l.reading) P.push(`AC-13 ${es.name}: pair ${day(l.a)} to ${day(l.b)} data-what-moved is ${moved[1]}`);
          if (textOf(moved[2]) !== whatMoved(l)) P.push(`AC-13 ${es.name}: pair ${day(l.a)} to ${day(l.b)} what moved reads ${JSON.stringify(textOf(moved[2]).slice(0, 160))}`);
          const bound = [...moved[2].matchAll(/<data value="([^"]*)" data-src="([^"]*)" data-at="run\.date_utc">([^<]*)<\/data>/g)].map((x) => [decode(x[2]), x[3], x[1]]);
          const wantBound = l.reading === 'separation' ? separated(l).flatMap(() => [l.b, l.a].map((x) => [x.rel, day(x), x.receipt.run.date_utc])) : [];
          if (JSON.stringify(bound) !== JSON.stringify(wantBound)) P.push(`AC-13 ${es.name}: pair ${day(l.a)} to ${day(l.b)} dates ${JSON.stringify(bound).slice(0, 160)}`);
        }
      });
      if (lines.length !== es.lines.length) P.push(`AC-4 ${es.name}: ${lines.length} pair lines for ${es.lines.length} pairs`);
    }
  }
  // AC-6: the key and the mapping.
  const keys = [...main.matchAll(/<p class="canary-key" data-key="([^"]*)">([\s\S]*?)<\/p>/g)].map((m) => [m[1], textOf(m[2])]);
  if (JSON.stringify(keys) !== JSON.stringify(T.key.map((k, i) => [String(i + 1), k]))) P.push(`AC-6 key sentences: ${JSON.stringify(keys.map((k) => k[1].slice(0, 30)))}`);
  // AC-14 (issue 765): the causes list names Driftproof's own version and scoring code, and says "could have", never "moved".
  const causes = keys.length ? keys[0][1] : '';
  for (const cause of ['the model behind the name', 'the harness that ran it', 'Driftproof\'s own version and scoring code', 'the judge model behind its name', 'the judge\'s own variation', 'chance']) if (!causes.includes(cause)) P.push(`AC-14 the causes list does not name ${cause}`);
  if (!causes.includes('could have moved') || /(?<!could have )\bmoved\b/.test(causes)) P.push(`AC-14 the causes list does not say "could have moved": ${JSON.stringify(causes.slice(0, 200))}`);
  const map = [...main.matchAll(/<dt><code data-differ-label="([^"]*)">([^<]*)<\/code><\/dt>\s*<dd data-reading="([^"]*)">([^<]*)<\/dd>/g)].map((m) => [m[1], decode(m[4]), m[3]]);
  if (JSON.stringify(map) !== JSON.stringify(MAP) || [...main.matchAll(/<dt>/g)].length !== MAP.length) P.push(`AC-6 the mapping table: ${JSON.stringify(map)}`);
  const yoursPs = yoursOf(main);
  const yoursHTML = yoursPs.join('\n');
  if (JSON.stringify(yoursPs.map(textOf)) !== JSON.stringify(T.yours) || !yoursHTML.includes('<a href="/across-models/">')) P.push('AC-8 the do-this-for-your-own-file paragraphs');
  // AC-17 (issue 765): the section opens with the command in Claude Code, says what a recheck compares with, and how far this page's check reaches.
  const firstCode = /<code>([^<]*)<\/code>/.exec(yoursPs[0] || '');
  if (!firstCode || firstCode[1] !== '/driftproof:recheck') P.push(`AC-17 the section does not open with /driftproof:recheck: ${firstCode ? firstCode[1] : 'no code element'}`);
  for (const c of ['driftproof recheck init --trusted-skill', 'driftproof recheck run --trusted-skill', 'driftproof recheck history']) if (!yoursHTML.includes(`<code>${c}</code>`)) P.push(`AC-17 the section does not carry ${c}`);
  const yoursText = yoursPs.map(textOf).join(' ');
  if (!/compares each new result with the previous one and with the first saved reading/.test(yoursText)) P.push('AC-17 the section does not say a recheck compares with the first saved reading');
  if (!yoursText.includes('This checks Claude through Claude Code with fixed tasks, not anyone\'s chat history.')) P.push('AC-17 the section does not say this checks Claude through Claude Code with fixed tasks, not anyone\'s chat history');
  // AC-16 (issue 765): the list named at the end also requires the same setup.
  if (!yoursText.includes('the same setup (how each answer was recorded and which sides of the comparison ran)')) P.push('AC-16 the list does not say it requires the same setup');
  // AC-7: the words outside the quoted material.
  const quoted = main.replace(/<(span|q|b)\b[^>]*\sdata-quote="[^"]*"[^>]*>[\s\S]*?<\/\1>/g, ' ').replace(/<code data-differ-label="[^"]*">[^<]*<\/code>/g, ' ');
  const words = textOf(quoted);
  if (DIRECTION.test(words)) P.push(`AC-7 direction word: ${DIRECTION.exec(words)[0]}`);
  if (INTERNAL.test(words)) P.push(`AC-7 internal name: ${INTERNAL.exec(words)[0]}`);
  if (LABEL_WORDS.test(words)) P.push(`AC-7 a differ label outside the mapping: ${LABEL_WORDS.exec(words)[0]}`);
  // AC-16 (issue 765): the two terms a reader could not follow are glossed or gone.
  for (const jargon of [/\bjudge samples?\b/i, /\bcaptured\b/i]) if (jargon.test(words)) P.push(`AC-16 jargon on the page: ${jargon.exec(words)[0]}`);
  const bare = quoted.replace(/<data\b[^>]*>[^<]*<\/data>/g, ' ').replace(/<span data-(?:date|model-name)>[^<]*<\/span>/g, ' ').replace(/<h3 data-skill-name>[\s\S]*?<\/h3>/g, ' ').replace(/<code\b[^>]*>[^<]*<\/code>/g, ' ').replace(/<q data-src="[^"]*" data-at="rule">[\s\S]*?<\/q>/g, ' ');
  const digit = /\d/.exec(textOf(bare));
  if (digit) P.push(`AC-7 a numeral outside the bound elements: ${JSON.stringify(textOf(bare).slice(Math.max(0, digit.index - 30), digit.index + 30))}`);
  return P;
}

// ── the fixture root: a manifest, two sealed receipts, a suite, the sources, two receipt pages ──
const BASE_REL = 'receipts/report-018/campaign-3/15f184740eeb8f5b8a59bbca38b7874ef631c46764ad7082f0d8b9920d7503fb.json';
const base = () => clone(json(ROOT, BASE_REL));
const later = (r, edit = () => {}) => { const c = clone(r); c.run.date_utc = '2026-11-09T10:00:00.000Z'; edit(c); return sealReceipt(c); };
const flipHash = (s) => s.slice(0, -1) + (s.endsWith('0') ? '1' : '0');
const SOURCE = () => json(ROOT, SOURCES).find((s) => s.skill === 'grill-me' && s.repository === 'mattpocock/skills');
let fixtures = 0;
function fixture({ a = base(), b = later(a), pairs, manifest, suite, sources, pages } = {}) {
  const root = path.join(scratch, `fixture-${++fixtures}`);
  const src = SOURCE();
  const entry = (x, y) => ({ skill: 'grill-me', repository: src.repository, commit: src.commit, skill_sha256: src.skill_sha256, suite: src.suite, before: 'receipts/fixture-742/a.json', after: 'receipts/fixture-742/b.json', ...(x || {}), ...(y || {}) });
  const m = manifest || { format: 'driftproof-canary/1', rule: 'A fixture: one skill, two dates.', pairs: pairs || [entry()] };
  const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
  put(MANIFEST, JSON.stringify(m, null, 2));
  put('receipts/fixture-742/a.json', JSON.stringify(a));
  put('receipts/fixture-742/b.json', JSON.stringify(b));
  put(`specs/408-skill-measurements/${src.suite}`, suite || read(ROOT, `specs/408-skill-measurements/${src.suite}`));
  put(SOURCES, JSON.stringify(sources || json(ROOT, SOURCES)));
  for (const r of pages || [a, b]) put(`docs/r/${r.receipt_hash}/index.html`, `<html>${r.receipt_hash}</html>`);
  return { root, entry, a, b };
}

let B, html, main;
test.before(() => { B = builder(); html = read(ROOT, `docs/${PAGE}`); main = mainOf(html); });
test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));

test('AC-1 to AC-8: the built page reads GREEN against the manifest, the receipts and the differ', () => {
  assert.deepEqual(checkPage(html), []);
  const exp = expected(ROOT);
  for (const c of exp.columns) assert.ok(c.skills.length >= 5, `${c.name}: five skills`);
  for (const x of exp.entries.values()) { assert.ok(validateReceipt(x.receipt).valid, `${x.rel} validates`); assert.ok(verifyReceiptHash(x.receipt), `${x.rel} verifies`); assert.ok(x.rel.startsWith('receipts/')); }
  // The subjects' rule: the first five non-router skills of Report 018's frozen attempt order.
  const plan = json(ROOT, 'receipts/report-018/plan.json');
  const routers = new Set(plan.routers.skills);
  const first = plan.execution.attempts.map((a) => a.protocol.skill).filter((s) => !routers.has(s)).slice(0, 5);
  for (const [model, dir] of [['claude-sonnet-5-5', 'receipts/report-017c/campaign-1/'], ['claude-haiku-5-5', 'receipts/report-018/campaign-3/']]) {
    const c = exp.columns.find((x) => x.model === model);
    assert.ok(c, `a ${model} column`);
    assert.deepEqual(c.skills.map((s) => s.name), first, `${c.name}: the first five non-router skills in plan order`);
    for (const s of c.skills) assert.ok(s.rows[0].rel.startsWith(dir), `${c.name} ${s.name}: the first row is the November report's receipt`);
    assert.equal(c.tasks, 15, `${c.name}: five skills of three tasks each`);
  }
  // Both columns are ordered by rule: the earliest date first.
  assert.deepEqual(exp.columns.map((c) => c.model), [...exp.columns].sort((a, b) => cmp(a.first, b.first)).map((c) => c.model));
  // A-742-2: the rule as first written stays in the manifest; only the reader's wording changed.
  assert.match(exp.manifest.rule_machine, /receipts\/report-018\/plan\.json/);
  assert.match(exp.manifest.rule_machine, /plan\.routers\.skills/);
});

const plants = [
  ['AC-1', 'a row of another receipt inserted into a skill list', (h) => {
    const exp = expected(ROOT);
    const other = exp.columns[0].skills[1].rows[0];
    const row = /<li class="canary-row" data-receipt="([^"]*)">[\s\S]*?<\/li>/.exec(h);
    return h.replace(row[0], `${row[0].split(row[1]).join(other.receipt.receipt_hash)}\n${row[0]}`);
  }],
  ['AC-1', 'a row removed', (h) => h.replace(/<li class="canary-row"[\s\S]*?<\/li>\n/, '')],
  ['AC-1', 'two skill lists swapped', (h) => { const s = [...h.matchAll(/<section class="canary-skill"[\s\S]*?<\/section>/g)].map((m) => m[0]); return h.replace(s[0], '@S0@').replace(s[1], s[0]).replace('@S0@', s[1]); }],
  ['AC-1', 'a skill list\'s suite attribute changed', (h) => h.replace(/data-suite="([0-9a-f])/, (m, c) => `data-suite="${c === '0' ? '1' : '0'}`)],
  ['AC-1', 'two columns swapped', (h) => { const s = [...h.matchAll(/<section class="canary-model"[\s\S]*?(?=<section class="canary-model"|<h2 id="key">)/g)].map((m) => m[0]); return h.replace(s[0], '@C0@').replace(s[1], s[0]).replace('@C0@', s[1]); }],
  ['AC-5', 'a separated task\'s direction flipped in the headline', (h) => h.replace(/<p class="canary-headline"[^>]*>(?:(?!<\/p>)[\s\S])*?scored lower/, (m) => m.replace(/scored lower$/, 'scored higher'))],
  ['AC-11', 'the caution removed from a column', (h) => h.replace(/<p class="canary-caution">[\s\S]*?<\/p>\n/, '')],
  ['AC-11', 'the caution\'s task count changed', (h) => h.replace(/<data value="(\d+)" data-count="tasks">[^<]*/, (m, n) => `<data value="${Number(n) + 1}" data-count="tasks">${Number(n) + 1}`)],
  ['AC-11', 'the caution made to say the separations are chance', (h) => h.replace('chance alone can produce some separations under this rule', 'these separations are chance under this rule')],
  ['AC-12', 'the recorded-versions line removed', (h) => h.replace(/<p class="canary-moved">[\s\S]*?<\/p>\n/, '')],
  ['AC-12', 'a recorded-versions count changed', (h) => h.replace(/<data value="(\d+)" data-moved="harness">[^<]*/, (m, n) => `<data value="${Number(n) + 1}" data-moved="harness">${W(Number(n) + 1)}`)],
  ['AC-12', 'the sentence about the model removed', (h) => h.replace(` ${T.modelLine}`, '')],
  ['AC-13', 'a pair line without what moved', (h) => h.replace(/ <span data-what-moved="separation">[\s\S]*?<\/span> Driftproof read:/, ' Driftproof read:')],
  ['AC-13', 'a pair line with no separation without what moved', (h) => h.replace(/ <span data-what-moved="none">[^<]*<\/span> Driftproof read:/, ' Driftproof read:')],
  ['AC-13', 'what moved flipped from lower to higher', (h) => h.replace(/(<span data-what-moved="separation">[\s\S]*?)scored lower/, '$1scored higher')],
  ['AC-13', 'the line saying the row averages can move the other way removed', (h) => h.replace(` ${T.moved.reconcile.replace(/'/g, '&#39;')}`, '')],
  ['AC-13', 'the line saying the row averages can move the other way added where they do not', (h) => h.replace(/(<span data-what-moved="separation">(?:(?!<\/span> Driftproof read:)[\s\S])*?scored higher(?:(?!<\/span> Driftproof read:)[\s\S])*?)<\/span> Driftproof read:/, `$1 ${T.moved.reconcile.replace(/'/g, '&#39;')}</span> Driftproof read:`)],
  ['AC-13', 'a date in what moved no longer bound to its receipt', (h) => h.replace(/(<span data-what-moved="separation">(?:(?!<\/span> Driftproof read:)[\s\S])*?)<data value="[^"]*" data-src="[^"]*" data-at="run\.date_utc">([^<]*)<\/data>/, '$1$2')],
  ['AC-14', 'a causes list without Driftproof\'s version', (h) => h.replace('Driftproof&#39;s own version and scoring code, ', '')],
  ['AC-14', 'the causes list saying they moved', (h) => h.replace('could have moved the scores', 'moved the scores')],
  ['AC-14', 'a model\'s summary without Driftproof\'s version', (h) => h.replace(` ${T.summaryCauses.replace(/'/g, '&#39;')}`, '')],
  ['AC-15', 'a path in the selection rule', (h) => h.replace(/(<q data-src="receipts\/canary\/manifest\.json" data-at="rule">)/, '$1Read from receipts/report-018/plan.json. ')],
  ['AC-15', 'a field name in the selection rule', (h) => h.replace(/(<q data-src="receipts\/canary\/manifest\.json" data-at="rule">)/, '$1Skipping plan.routers.skills. ')],
  ['AC-15', 'a digest\'s name in the selection rule', (h) => h.replace(/(<q data-src="receipts\/canary\/manifest\.json" data-at="rule">)/, '$1Refused unless its sha256 matched. ')],
  ['AC-15', 'a skill changed in the selection rule', (h) => h.replace(/(data-at="rule">[\s\S]*?)improve-codebase-architecture/, '$1another-skill')],
  ['AC-15', 'the rule\'s report link pointing at no report', (h) => h.replace(/(data-at="rule">[^<]*<a href=")\/reports\/\d{3}\//, '$1/reports/999/')],
  ['AC-16', 'judge samples back in the setup line', (h) => h.replace('the same number of times per answer', 'the same number of judge samples')],
  ['AC-16', 'captured back in the setup line', (h) => h.replace('with each answer recorded the same way', 'with the answer captured the same way')],
  ['AC-16', 'the list no longer saying the same setup', (h) => h.replace('and the same setup (how each answer was recorded and which sides of the comparison ran) ', '')],
  ['AC-17', 'the section not opening with the command in Claude Code', (h) => h.replace('<code>/driftproof:recheck</code>', 'the recheck command')],
  ['AC-17', 'the terminal line without --trusted-skill', (h) => h.replace('<code>driftproof recheck init --trusted-skill</code>', '<code>driftproof recheck init</code>')],
  ['AC-17', 'the terminal line running the saved copy without --trusted-skill', (h) => h.replace('<code>driftproof recheck run --trusted-skill</code>', '<code>driftproof recheck run</code>')],
  ['AC-17', 'the section no longer saying what a recheck compares with', (h) => h.replace(' and with the first saved reading', '')],
  ['AC-17', 'the line about chat history removed', (h) => h.replace(/<p>This checks Claude through Claude Code with fixed tasks, not anyone&#39;s chat history\.<\/p>\n/, '')],
  ['AC-3', 'a date typed by hand', (h) => h.replace(/(<li class="canary-row"[^>]*><a href="[^"]*"><span data-date>)(\d{4})/, (m, a, y) => `${a}${Number(y) - 1}`)],
  ['AC-3', 'a band typed by hand', (h) => h.replace(/(data-at="results\.aggregates\.with_skill\.mean_score">)([^<]*)(<\/data>)/, '$10.999$3')],
  ['AC-3', 'a bound value changed', (h) => h.replace(/<data value="([^"]*)"( data-src="[^"]*" data-at="results\.aggregates\.baseline\.stddev">)/, '<data value="0.000001"$2')],
  ['AC-3', 'a harness version typed by hand', (h) => h.replace(/(data-at="run\.harness\.version">)[^<]*/, '$19.9.9')],
  ['AC-3', 'two rows\' links swapped', (h) => {
    const s = /<section class="canary-skill"[\s\S]*?<\/section>/.exec(h)[0];
    const rows = [...s.matchAll(/<li class="canary-row" data-receipt="([^"]*)">/g)].map((m) => m[1]);
    return h.replace(s, s.replace(`<a href="/r/${rows[0]}/">`, '<a href="@L@">').replace(`<a href="/r/${rows[1]}/">`, `<a href="/r/${rows[0]}/">`).replace('<a href="@L@">', `<a href="/r/${rows[1]}/">`));
  }],
  ['AC-4', 'one word of a pair line changed', (h) => h.replace(/(<span data-rest data-quote="text">)([^<]*)/, (m, a, t) => `${a}${t.replace(/[A-Za-z]+/, 'altered')}`)],
  ['AC-4', 'the plain words of a pair line changed', (h) => h.replace(/<b data-plain>[^<]*<\/b>/, '<b data-plain>Nothing changed</b>')],
  ['AC-4', 'a pair line removed', (h) => h.replace(/<li class="canary-pair"[\s\S]*?<\/li>\n/, '')],
  ['AC-4', 'a pair line added', (h) => h.replace(/(<li class="canary-pair"[\s\S]*?<\/li>\n)/, '$1$1')],
  ['AC-4', 'the verbatim headline attribute changed', (h) => h.replace(/data-headline="([^"]*)"/, (m, t) => `data-headline="${t.replace(/[A-Za-z]+/, 'altered')}"`)],
  ['AC-4', 'a refusal key written into the text', (h) => h.replace(/(<li class="canary-pair"[^>]*>)/, '$1Refused as baseline_did_not_reproduce. ')],
  ['AC-4', 'a pair line\'s refusal attribute removed or added', (h) => (/ data-refusal="/.test(h) ? h.replace(/ data-refusal="[^"]*"/, '') : h.replace('<li class="canary-pair"', '<li class="canary-pair" data-refusal="baseline_did_not_reproduce"'))],
  ['AC-5', 'a count\'s words changed', (h) => h.replace(/(<data value="[^"]*" data-count="none">)[^<]*/, '$1four')],
  ['AC-5', 'a count\'s value changed', (h) => h.replace(/<data value="([^"]*)"( data-count="none">)/, (m, v, rest) => `<data value="${Number(v) + 1}"${rest}`)],
  ['AC-5', 'a pair line\'s reading flipped so the counts no longer sum', (h) => h.replace(/data-reading="none"/, 'data-reading="separation"')],
  ['AC-5', 'the skills count changed', (h) => h.replace(/(<data value=")(\d+)(" data-count="skills">)[^<]*/, (m, a, n, b) => `${a}${Number(n) + 1}${b}${cap(W(Number(n) + 1))}`)],
  ['AC-5', 'a date in the headline changed', (h) => h.replace(/(<p class="canary-headline"[^>]*>[\s\S]*?<span data-date>)(\d{4})/, (m, a, y) => `${a}${Number(y) - 1}`)],
  ['AC-6', 'a key sentence removed', (h) => h.replace(/<p class="canary-key" data-key="3">[\s\S]*?<\/p>\n/, '')],
  ['AC-6', 'a key sentence reworded', (h) => h.replace(/(<p class="canary-key" data-key="1">[\s\S]*?)never attributed/, '$1attributed to the model')],
  ['AC-6', 'a mapping entry removed', (h) => h.replace(/<dt><code data-differ-label="MIXED">[\s\S]*?<\/dd>\n?/, '')],
  ['AC-6', 'a column\'s judge sentence contradicting its receipts', (h) => h.replace(/<span data-judge="(same|other)">[^<]*<\/span>/, (m, k) => `<span data-judge="${k === 'same' ? 'other' : 'same'}">${k === 'same' ? T.judge.other : T.judge.same}</span>`)],
  ['AC-7', 'the word "worse" on the page', (h) => h.replace('<p class="canary-setup">', '<p class="canary-setup">The model got worse. ')],
  ['AC-7', 'the word "better" on the page', (h) => h.replace('<p class="lede">', '<p class="lede">It got better. ')],
  ['AC-7', 'a numeral typed into the setup paragraph', (h) => h.replace('<p class="canary-setup">', '<p class="canary-setup">Run 3 of 3. ')],
  ['AC-7', 'an internal state name written into a paragraph', (h) => h.replace('<p class="canary-setup">', '<p class="canary-setup">Every case read WITHIN_NOISE. ')],
  ['AC-7', 'a differ label written outside the mapping', (h) => h.replace('<p class="canary-setup">', '<p class="canary-setup">Every pair read NO SEPARATION DETECTED. ')],
  ['AC-8', 'the rule quoted is not the manifest\'s', (h) => h.replace(/(<q data-src="receipts\/canary\/manifest\.json" data-at="rule">)([^<]*)/, (m, a, t) => `${a}${t.replace(/[A-Za-z]+/, 'altered')}`)],
  ['AC-8', 'the what-this-is paragraph reworded', (h) => h.replace('promises no schedule', 'runs every week')],
];
for (const [ac, what, plant] of plants) {
  test(`${ac} plant: ${what} reads RED`, () => {
    const after = plant(html);
    assert.notEqual(after, html, 'the plant changed the page');
    const problems = checkPage(after);
    assert.ok(problems.some((p) => p.startsWith(`${ac} `)), `expected an ${ac} problem, got ${JSON.stringify(problems.slice(0, 4))}`);
  });
}

// ── the builder's call paths, on sealed fixtures in a scratch root ────────────────────────────────
test('AC-1 fixtures: a pair alike on the group key renders and reads GREEN; one byte of the suite hash, another model, a wrong source digest, an edited suite or reversed dates refuse', () => {
  const ok = fixture();
  const page = B.pageOf({ root: ok.root });
  assert.deepEqual(checkPage(page.html, { root: ok.root, pages: false }), []);
  assert.equal(page.data.columns.length, 1);
  assert.deepEqual(page.data.columns[0].skills[0].rows.map((x) => x.rel), ['receipts/fixture-742/a.json', 'receipts/fixture-742/b.json']);
  const a = base();
  assert.throws(() => B.pairsOf({ root: fixture({ a, b: later(a, (c) => { c.suite.suite_hash = flipHash(c.suite.suite_hash); }) }).root }), code('PAIR_UNLIKE'), 'one byte of the suite hash');
  assert.throws(() => B.pairsOf({ root: fixture({ a, b: later(a, (c) => { c.run.model_id = 'claude-sonnet-5-5'; }) }).root }), code('PAIR_UNLIKE'), 'another model');
  // A files capture, valid under the schema once the text-only fake-tool-call block is gone.
  assert.throws(() => B.pairsOf({ root: fixture({ a, b: later(a, (c) => { c.run.capture = { mode: 'files' }; delete c.results.fake_tool_calls; }) }).root }), code('PAIR_UNLIKE'), 'another capture');
  assert.throws(() => B.pairsOf({ root: fixture({ a, b: later(a, (c) => { delete c.run.judge.model_id; for (const x of c.results.cases) delete x.judge.model_id; }) }).root }), (e) => ['PAIR_UNLIKE', 'RECEIPT_INVALID'].includes(e.code), 'a judge unrecorded on one side');
  assert.equal(B.pairsOf({ root: fixture({ a, b: later(a, (c) => { c.run.model_id = `${c.run.model_id}-20260101`; }) }).root }).columns.length, 1, 'a dated id of the same model is the same model');
  const f = fixture();
  assert.throws(() => B.pairsOf({ root: fixture({ pairs: [f.entry({ skill_sha256: flipHash(SOURCE().skill_sha256) })] }).root }), code('SOURCE_BINDING'), 'a source digest changed by one byte');
  assert.throws(() => B.pairsOf({ root: fixture({ pairs: [f.entry({ commit: flipHash(SOURCE().commit) })] }).root }), code('SOURCE_BINDING'), 'another commit');
  assert.throws(() => B.pairsOf({ root: fixture({ pairs: [f.entry({ skill: 'tdd' })] }).root }), (e) => ['SKILL_BINDING', 'SOURCE_BINDING'].includes(e.code), 'a skill the receipts did not measure');
  const suite = JSON.parse(read(ROOT, `specs/408-skill-measurements/${SOURCE().suite}`));
  suite.cases[0].prompt = suite.cases[0].prompt.replace(/.$/, (ch) => (ch === '.' ? '!' : '.'));
  assert.throws(() => B.pairsOf({ root: fixture({ suite: JSON.stringify(suite) }).root }), code('SUITE_BINDING'), 'a suite with one prompt character changed');
  assert.throws(() => B.pairsOf({ root: fixture({ pairs: [f.entry({ suite: 'suites/mattpocock--skills--tdd.json' })] }).root }), (e) => ['SUITE_BINDING', 'SOURCE_BINDING'].includes(e.code), 'another suite named');
  assert.throws(() => B.pairsOf({ root: fixture({ pairs: [f.entry({ before: 'receipts/fixture-742/b.json', after: 'receipts/fixture-742/a.json' })] }).root }), code('PAIR_ORDER'), 'the dates reversed');
  // Two pairs that do not chain: a to b and a to c, where b and c are adjacent rows no pair names.
  const b = later(a); const c = later(a, (x) => { x.run.date_utc = '2026-11-10T10:00:00.000Z'; });
  const g = fixture({ a, b, pairs: [f.entry(), f.entry({ after: 'receipts/fixture-742/c.json' })], pages: [a, b, c] });
  fs.writeFileSync(path.join(g.root, 'receipts/fixture-742/c.json'), JSON.stringify(c));
  assert.throws(() => B.pairsOf({ root: g.root }), code('CHAIN'));
  // Two pairs that chain (a to b, b to c) render three rows and two pair lines.
  const h2 = fixture({ a, b, pairs: [f.entry(), f.entry({ before: 'receipts/fixture-742/b.json', after: 'receipts/fixture-742/c.json' })], pages: [a, b, c] });
  fs.writeFileSync(path.join(h2.root, 'receipts/fixture-742/c.json'), JSON.stringify(c));
  const three = B.pageOf({ root: h2.root });
  assert.equal(three.data.columns[0].skills[0].rows.length, 3);
  assert.deepEqual(checkPage(three.html, { root: h2.root, pages: false }), []);
});

test('AC-2 fixtures: an edited receipt, an unknown schema version and a path outside receipts/ refuse before anything is rendered; the builder fetches nothing', () => {
  const a = base();
  const edited = later(a); edited.results.aggregates.with_skill.mean_score = 0.123456;
  for (const fn of ['pairsOf', 'pageOf']) assert.throws(() => B[fn]({ root: fixture({ a, b: edited }).root }), code('RECEIPT_SEAL'), `${fn}: edited after sealing`);
  assert.throws(() => B.pairsOf({ root: fixture({ a, b: later(a, (c) => { c.schema_version = '9.9'; }) }).root }), code('RECEIPT_INVALID'));
  const f = fixture();
  for (const bad of ['../x.json', '/tmp/x.json', 'docs/x.json', 'receipts/../docs/x.json', 'receipt/x.json']) assert.throws(() => B.pairsOf({ root: fixture({ pairs: [f.entry({ after: bad })] }).root }), code('MANIFEST_PATH'), bad);
  assert.throws(() => B.pairsOf({ root: fixture({ pairs: [f.entry({ after: 'receipts/fixture-742/missing.json' })] }).root }), (e) => /RECEIPT|exist/i.test(e.code || e.message), 'a missing receipt');
  assert.throws(() => B.pairsOf({ root: fixture({ manifest: { format: 'driftproof-canary/2', rule: 'x', pairs: [] } }).root }), code('MANIFEST_FORMAT'));
  assert.throws(() => B.pairsOf({ root: fixture({ manifest: { format: 'driftproof-canary/1', rule: 'x', pairs: [] } }).root }), code('MANIFEST_EMPTY'));
  const out = path.join(scratch, 'write-refuses'); fs.mkdirSync(out, { recursive: true });
  assert.throws(() => B.write({ root: fixture({ a, b: edited }).root, out }), code('RECEIPT_SEAL'));
  assert.ok(!fs.existsSync(path.join(out, PAGE)), 'nothing written on a refusal');
  const src = read(ROOT, 'scripts/build-did-it-change.js').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(src, /\bfetch\s*\(|require\(['"](?:node:)?(?:https?|net|dns|child_process)['"]\)/, 'the builder reaches no network');
});

test('AC-3 and AC-4 fixtures: an incomplete receipt reads not measured and its pair line the differ\'s not-measured headline; a receipt page missing refuses; an unknown label refuses', () => {
  const a = base();
  const inc = later(a, (c) => { c.run.status = 'incomplete'; c.run.failed_case_count = 1; });
  const f = fixture({ a, b: inc });
  const page = B.pageOf({ root: f.root });
  assert.deepEqual(checkPage(page.html, { root: f.root, pages: false }), []);
  const rows = [...page.html.matchAll(/<li class="canary-row"[^>]*>([\s\S]*?)<\/li>/g)].map((m) => textOf(m[1]));
  assert.match(rows[1], /With the skill not measured, without it not measured\./);
  const line = /<li class="canary-pair"([^>]*)>/.exec(page.html)[1];
  assert.match(line, /data-label="NOT MEASURED" data-reading="no-verdict"/);
  assert.ok(/<p class="canary-headline"[^>]*data-no-verdict="1"/.test(page.html));
  assert.throws(() => B.pageOf({ root: fixture({ pages: [] }).root }), code('RECEIPT_PAGE'), 'no receipt page');
  assert.throws(() => B.mapHeadline('SOMETHING ELSE: words.'), code('HEADLINE_LABEL'));
  assert.throws(() => B.mapHeadline('no label at all'), code('HEADLINE_LABEL'));
  assert.deepEqual(B.mapHeadline('REFUSED — the baseline arm did not reproduce.'), { label: 'REFUSED', rest: 'the baseline arm did not reproduce.', plain: 'Refused', reading: 'no-verdict' });
  assert.deepEqual(B.MAPPING.map((m) => [m.label, m.plain, m.reading]), MAP);
});

test('AC-11 and AC-12 fixtures: the counts follow the receipts, and a field a receipt lacks reads not recorded', () => {
  const a = base();
  const same = B.pageOf({ root: fixture({ a, b: later(a) }).root });
  assert.match(textOf(/<p class="canary-moved">([\s\S]*?)<\/p>/.exec(same.html)[1]), /Of the one pair below, the receipts record a different version of Driftproof on none, a different revision of its scoring code on none and a different version of the harness on none\./);
  assert.match(textOf(/<p class="canary-caution">([\s\S]*?)<\/p>/.exec(same.html)[1]), /^Across these three test tasks,/);
  assert.ok(!textOf(/<p class="canary-moved">([\s\S]*?)<\/p>/.exec(same.html)[1]).includes(T.summaryCauses), 'A-742-2: nothing recorded as different, so the summary does not name them');
  const moved = fixture({ a, b: later(a, (c) => { c.run.harness.version = '9.9.9'; c.run.runner_version = '9.9.9'; }) });
  const page = B.pageOf({ root: moved.root });
  assert.deepEqual(checkPage(page.html, { root: moved.root, pages: false }), []);
  assert.match(textOf(/<p class="canary-moved">([\s\S]*?)<\/p>/.exec(page.html)[1]), /a different version of Driftproof on one, a different revision of its scoring code on none and a different version of the harness on one\./);
  // A field one receipt lacks is neither the same nor different.
  const R = (runner, code, harness) => ({ receipt: { run: { runner_version: runner, judge: code ? { code_revision: code } : {}, ...(harness ? { harness: { name: 'claude-code', version: harness } } : {}) } } });
  const lines = [{ a: R('1', 'x', '2'), b: R('1', null, null) }];
  assert.deepEqual(B.movedCounts(lines), movedOf(lines));
  assert.deepEqual(B.movedCounts(lines), { runner: { differ: 0, unrecorded: 0 }, code: { differ: 0, unrecorded: 1 }, harness: { differ: 0, unrecorded: 1 } });
  assert.equal(textOf(B.movedHTML({ counts: { pairs: 1 }, moved: B.movedCounts(lines) })), movedText(1, movedOf(lines)));
  assert.match(movedText(1, movedOf(lines)), /on none \(not recorded on one\)/);
});

test('AC-13: the reconciling sentence compares the averages as the rows print them, never unrounded', () => {
  const R = (rel, date, mean) => ({ rel, receipt: { run: { date_utc: date }, results: { aggregates: { with_skill: { mean_score: mean } } } } });
  const line = (ma, mb) => ({ reading: 'separation', perCase: [{ id: 'adr', verdict: 'regression' }], a: R('receipts/a.json', '2026-11-01T00:00:00.000Z', ma), b: R('receipts/b.json', '2026-11-08T00:00:00.000Z', mb) });
  for (const [ma, mb, want, why] of [[0.78340, 0.78344, false, 'equal as the rows print them'], [0.7834, 0.795, true, 'the rows show a rise while the task fell'], [0.795, 0.7834, false, 'the rows fall with the task']]) {
    const l = line(ma, mb);
    assert.equal(textOf(B.whatMovedHTML(l)), whatMoved(l), why);
    assert.equal(whatMoved(l).includes(T.moved.reconcile), want, why);
  }
});

test('AC-17: the page\'s terminal commands, run in order against the CLI\'s usage text, use only flags the CLI declares for each command', (t) => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'bin/driftproof'), '--help'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const usage = r.stdout;
  const yours = yoursOf(mainOf(html)).join('\n');
  assert.ok(usageFlags(usage, 'init').includes('--judge-model'), 'a usage line is read with the lines that continue it');
  assert.equal(usageFlags(usage, 'nosuch'), null);
  assert.deepEqual(commandProblems(yours, usage, PENDING_755), [], 'the live CLI, with only the flag #755 adds set aside');
  const waiting = commandProblems(yours, usage);
  if (waiting.length) t.diagnostic(`waiting for #755: ${waiting.join('; ')}`);
  // The form #755 gives the usage text: the page reads GREEN with nothing set aside.
  // Built from the live text with the flag taken out first, so this reads the same before and after #755 lands.
  const without = usage.split('\n').map((l) => (/^\s*driftproof recheck (?:init|run)\b/.test(l) ? l.replace(/\s*\[--trusted-skill\]/g, '') : l)).join('\n');
  const initOnly = without.replace(/(driftproof recheck init <[^\n]*)/, '$1 [--trusted-skill]');
  const landed = initOnly.replace(/(driftproof recheck run <[^\n]*)/, '$1 [--trusted-skill]');
  assert.ok(usageFlags(landed, 'run').includes('--trusted-skill') && !usageFlags(initOnly, 'run').includes('--trusted-skill'));
  assert.deepEqual(commandProblems(yours, landed), [], 'with the flag declared for init and run, nothing is set aside');
  const plant = (from, to) => { assert.ok(yours.includes(from), from); return yours.replace(from, to); };
  const reads = (problems, re) => assert.ok(problems.some((p) => re.test(p)), JSON.stringify(problems));
  for (const u of [landed, usage]) {
    reads(commandProblems(plant('recheck run --trusted-skill<', 'recheck run --no-such-flag<'), u, PENDING_755), /recheck run uses --no-such-flag/);
    reads(commandProblems(plant('recheck run --trusted-skill<', 'recheck run --trusted-skill --json<'), u, PENDING_755), /recheck run uses --json/);
    reads(commandProblems(plant('recheck history<', 'recheck history --trusted-skill<'), u, PENDING_755), /recheck history uses --trusted-skill/);
    reads(commandProblems(plant('recheck run --trusted-skill<', 'recheck run<'), u, PENDING_755), /run without it/);
  }
  reads(commandProblems(yours, initOnly), /recheck run uses --trusted-skill/);
  const swapped = yours.replace('<code>driftproof recheck history</code>', '@H@').replace('<code>driftproof recheck run --trusted-skill</code>', '<code>driftproof recheck history</code>').replace('@H@', '<code>driftproof recheck run --trusted-skill</code>');
  reads(commandProblems(swapped, landed), /in the order init, history, run/);
});

test('AC-6 fixture: a column whose receipts disagree on whether the judge is the model refuses', () => {
  const a = base();
  assert.equal(judgeSelf(a), true, 'the fixture\'s judge is its model');
  const other = later(a, (c) => { c.run.judge.model_id = 'claude-sonnet-5-5'; for (const x of c.results.cases) if (x.judge) x.judge.model_id = 'claude-sonnet-5-5'; });
  // A different judge model is a different group key first; the judge sentence is read only on an alike pair.
  assert.throws(() => B.pairsOf({ root: fixture({ a, b: other }).root }), code('PAIR_UNLIKE'));
  // A-742-3: two skill lists in one column, each pair alike, one judged by the model and one by another model. Every receipt
  // here is valid, so the refusal is what stops the build.
  const TDD = 'receipts/report-018/campaign-3/01a1a4d088c9eadbc2517089778a286cf77017e9a868d4d0c250fd33f6bb08a4.json';
  const tdd = json(ROOT, SOURCES).find((s) => s.skill === 'tdd' && s.repository === 'mattpocock/skills');
  const toSonnet = (c) => { c.run.judge.model_id = 'claude-sonnet-5-5'; for (const x of c.results.cases) if (x.judge) x.judge.model_id = 'claude-sonnet-5-5'; };
  const entry = fixture().entry;
  const column = (edit) => {
    const b = later(a);
    const first = clone(json(ROOT, TDD)); edit(first);
    const c = sealReceipt(first);
    const d = later(json(ROOT, TDD), edit);
    for (const r of [a, b, c, d]) assert.ok(validateReceipt(r).valid, `${r.skill.name} validates`);
    const g = fixture({ a, b, pages: [a, b, c, d], pairs: [entry(), entry({ skill: 'tdd', repository: tdd.repository, commit: tdd.commit, skill_sha256: tdd.skill_sha256, suite: tdd.suite, before: 'receipts/fixture-742/c.json', after: 'receipts/fixture-742/d.json' })] });
    fs.writeFileSync(path.join(g.root, 'receipts/fixture-742/c.json'), JSON.stringify(c));
    fs.writeFileSync(path.join(g.root, 'receipts/fixture-742/d.json'), JSON.stringify(d));
    const suite = `specs/408-skill-measurements/${tdd.suite}`;
    fs.writeFileSync(path.join(g.root, suite), read(ROOT, suite));
    return g.root;
  };
  const mixed = column(toSonnet);
  assert.throws(() => B.pairsOf({ root: mixed }), code('JUDGE_MIXED'));
  assert.equal(B.pairsOf({ root: column(() => {}) }).columns.length, 1, 'with one judge relationship the same two lists build');
  // The plant: the builder with its refusal removed, compiled in memory so nothing is written, builds the mixed column.
  const file = path.join(ROOT, 'scripts/build-did-it-change.js');
  const source = read(ROOT, 'scripts/build-did-it-change.js');
  const refusal = 'need(selves.length === 1, \'JUDGE_MIXED\');';
  assert.ok(source.includes(refusal), 'the refusal is where this plant looks for it');
  const planted = new Module(file, module);
  planted.filename = file;
  planted.paths = Module._nodeModulePaths(path.dirname(file));
  planted._compile(source.replace(refusal, ''), file);
  assert.doesNotThrow(() => planted.exports.pairsOf({ root: mixed }), 'with the refusal removed nothing refuses, so the assertion above reads RED');
});

test('NFR-1: a date carrying markup is escaped where the page prints it, though the validator refuses one first', () => {
  const x = (date) => ({ rel: 'receipts/a.json', receipt: { run: { date_utc: date } } });
  const line = B.pairHTML({ a: x('2026<b>x</b>-11'), b: x('2026-11-08T10:00:00.000Z'), text: 't', label: 'NO SEPARATION DETECTED', reading: 'none', refusal: null, plain: 'p', rest: 'r', perCase: [] });
  assert.ok(!line.includes('2026<b>x'), 'no raw markup from a receipt date');
  assert.ok(line.includes('<span data-date>2026&lt;b&gt;x'), 'the date is escaped');
  const a = base();
  assert.throws(() => B.pageOf({ root: fixture({ a, b: later(a, (c) => { c.run.date_utc = '2026<b>x</b>-11-09T10:00:00.000Z'; }) }).root }), code('RECEIPT_INVALID'));
});

test('AC-18: the canary manifest is not a receipt: it has no plot, and no home example is drawn from one', async () => {
  const { receiptFiles, keyOf } = await import('../scripts/band-plot.mjs');
  const root = path.join(scratch, 'plot-root');
  const put = (rel, value) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), JSON.stringify(value)); };
  put('receipts/canary/manifest.json', { format: 'driftproof-canary/1', rule: 'x', pairs: [] });
  put('receipts/report-016/manifest.json', {});
  put('receipts/canary/2026-11-08/one.json', base());
  put('receipts/canary/2026-11-08/manifest.json', base());
  put('receipts/report-006/one.control.json', { cell: 'one', control: true });
  assert.deepEqual(receiptFiles(root).map((f) => path.relative(root, f).split(path.sep).join('/')), ['receipts/canary/2026-11-08/manifest.json', 'receipts/canary/2026-11-08/one.json', 'receipts/report-006/one.control.json'], 'a manifest beside receipts yields no plot; the skip is that one path, and a control record stays');
  assert.deepEqual(fs.readdirSync(path.join(DOCS, 'plots')).filter((n) => n.startsWith('canary--manifest.')), [], 'the published plots are gone');
  const cells = new Set(receiptFiles(ROOT).map((f) => keyOf(f, ROOT)));
  const notCells = (h) => [...h.matchAll(/\/plots\/([^"]+?)\.card\.svg/g)].map((m) => m[1]).filter((k) => !cells.has(k) || k === 'canary--manifest');
  const home = read(ROOT, 'docs/index.html');
  assert.deepEqual(notCells(home), [], 'every example on the home page is drawn from a file the builder lists as a cell');
  assert.match(home, /\/plots\/report-006--[^"]*\.control\.card\.svg/, 'the Refused example is a real refusal again');
  const planted = home.replace(/\/plots\/report-006--[^"]*\.control\.card\.svg/, '/plots/canary--manifest.card.svg');
  assert.notEqual(planted, home);
  assert.deepEqual(notCells(planted), ['canary--manifest'], 'plant: the manifest\'s plot back on the home page reads RED');
});

test('AC-8: registered once by the marker; footer, home doors, README, llms, sitemap and page dates follow; --check reproduces the page', { timeout: 600000 }, () => {
  const src = read(ROOT, 'scripts/build-did-it-change.js');
  assert.match(src, /^\/\/ Site builder: \{"href":"\/did-it-change\/","label":"Did the AI change\?"\}$/m);
  const pages = require('../scripts/reader-pages').pages();
  assert.ok(pages.some((p) => p.href === URL_PATH && p.label === T.h1));
  assert.equal(pages.filter((p) => p.href === URL_PATH).length, 1);
  assert.equal((/<title>([^<]*)<\/title>/.exec(html) || [])[1], T.title);
  assert.ok(T.title.length <= 60);
  assert.equal(decode(/<meta name="description" content="([^"]*)">/.exec(html)[1]), T.lede);
  assert.equal(require('../scripts/build-head-tags.js').pageDescription(html), T.lede, 'the head builder derives the description from the lede');
  assert.match(html, /<link rel="canonical" href="https:\/\/driftproofhq\.com\/did-it-change\/">/);
  for (const f of ['docs/index.html', 'docs/glossary/index.html', 'docs/across-models/index.html', 'docs/r/index.html']) assert.ok(read(ROOT, f).includes(`<a href="${URL_PATH}">${T.h1}</a>`), `${f} links the page by its title`);
  const home = read(ROOT, 'docs/index.html');
  const hero = home.slice(home.indexOf('id="hero"'), home.indexOf('</section>', home.indexOf('id="hero"')));
  assert.ok(hero.includes(`href="${URL_PATH}"`), 'a home door');
  assert.ok(read(ROOT, 'README.md').includes(`[${T.h1}](https://driftproofhq.com${URL_PATH})`), 'the README reader list');
  const llms = read(ROOT, 'docs/llms.txt');
  assert.ok(llms.includes(`- [${T.h1}](https://driftproofhq.com${URL_PATH}): ${T.lede}\n`), 'llms.txt');
  assert.ok(read(ROOT, 'docs/llms-full.txt').includes(`](https://driftproofhq.com${URL_PATH})`), 'llms-full.txt');
  const date = JSON.parse(read(ROOT, 'docs/data/page-dates.json')).dates[PAGE];
  assert.match(String(date), /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(read(ROOT, 'docs/sitemap-pages.xml').includes(`<url><loc>https://driftproofhq.com${URL_PATH}</loc><lastmod>${date}</lastmod></url>`));
  // The scripts: the shared chrome's and nothing of the page's own; no island of its own.
  const ALLOWED = ['/islands/loader.js', '/copy-button.js', 'https://static.cloudflareinsights.com/beacon.min.js'];
  const scriptProblems = (h) => tokenize(h).filter((t) => t.type === 'start' && t.name === 'script' && attrOf(t, 'type') !== 'application/ld+json').filter((t) => !ALLOWED.includes(attrOf(t, 'src'))).map((t) => t.raw);
  assert.deepEqual(scriptProblems(html), []);
  assert.deepEqual(scriptProblems(html.replace('</body>', '<script src="/x.js"></script></body>')), ['<script src="/x.js">'], 'plant');
  assert.deepEqual([...html.matchAll(/data-island="([^"]+)"/g)].map((m) => m[1]), ['jargon-cards']);
  assert.doesNotMatch(main, /<form\b|onclick=|role="link"/i);
  // --check: the committed page is the builder's; a byte changed or a page missing reads stale.
  assert.doesNotThrow(() => B.check());
  const out = path.join(scratch, 'docs');
  const files = B.write({ out });
  assert.deepEqual(files.map((f) => path.relative(out, f.file)), [PAGE], 'one file');
  assert.doesNotThrow(() => B.check({ out }));
  const was = read(out, PAGE);
  fs.writeFileSync(path.join(out, PAGE), was.replace(/e/, 'E'));
  assert.throws(() => B.check({ out }), code('DID_IT_CHANGE_DRIFT'));
  fs.rmSync(path.join(out, PAGE));
  assert.throws(() => B.check({ out }), code('DID_IT_CHANGE_DRIFT'));
  const cli = spawnSync(process.execPath, [path.join(ROOT, 'scripts/build-did-it-change.js'), '--check'], { cwd: ROOT, encoding: 'utf8', timeout: 300000 });
  assert.equal(cli.status, 0, cli.stdout + cli.stderr);
  assert.equal(spawnSync(process.execPath, [path.join(ROOT, 'scripts/build-did-it-change.js'), '--bogus'], { cwd: ROOT, encoding: 'utf8' }).status, 1, 'an unknown argument is refused');
});

test('AC-9: the stylesheet uses tokens and no unguarded motion', () => {
  const css = read(DOCS, STYLE).replace(/\/\*[\s\S]*?\*\//g, ' ');
  const rest = css.replace(/@media\s*\(prefers-reduced-motion:\s*no-preference\)\s*\{[\s\S]*?\n\}/g, ' ');
  assert.doesNotMatch(rest, /\b(transition|animation)\s*:|@keyframes/, 'no motion outside the guard');
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, 'no raw colour');
  for (const m of css.matchAll(/(?:^|[;{])\s*font-size\s*:\s*([^;}]+)/gm)) assert.match(m[1].trim(), /^var\(--t-[a-z0-9-]+\)$/, `font-size ${m[1]}`);
  for (const m of css.matchAll(/(?:^|[;{])\s*border-radius\s*:\s*([^;}]+)/gm)) assert.equal(m[1].trim(), 'var(--radius)');
  for (const m of css.matchAll(/(?:^|[;{])\s*max-width\s*:\s*([^;}]+)/gm)) assert.match(m[1].trim(), /^(var\(--w-[a-z-]+\)|100%|none)$/);
  assert.match(html, new RegExp(`<link rel="stylesheet" href="${URL_PATH}style.css">`));
});

test('AC-10: the receipts are published through the builders and the siblings follow', () => {
  const exp = expected(ROOT);
  const across = read(ROOT, 'docs/across-models/index.html');
  const record = JSON.parse(read(ROOT, 'specs/119-verdict-bounds-lost-draws/evidence/ac5-page-record.json'));
  for (const x of exp.entries.values()) {
    const h = x.receipt.receipt_hash;
    assert.ok(fs.existsSync(path.join(DOCS, 'r', h, 'index.html')) && fs.existsSync(path.join(DOCS, 'r', h, 'badge.svg')), `${x.rel}: page and badge`);
    assert.ok(read(DOCS, `r/${h}/index.html`).includes(h));
    assert.ok(across.includes(`<li class="dates-row" data-receipt="${h}">`), `${x.rel}: in the dates list of /across-models/ by spec 731's rule`);
    assert.ok(Object.hasOwn(record.pages, x.rel), `${x.rel}: in spec 119's page record`);
    if (x.rel.startsWith('receipts/canary/')) {
      assert.ok(fs.existsSync(path.join(ROOT, x.rel.replace(/\.json$/, '.summary.md'))), `${x.rel}: its summary beside it`);
      assert.ok(/^receipts\/canary\/\d{4}-\d{2}-\d{2}\/[^/]+\.json$/.test(x.rel), 'under receipts/canary/<run-date>/');
      assert.ok(!fs.existsSync(path.join(ROOT, path.dirname(x.rel), 'SKILL.md')), 'no third-party SKILL.md bytes committed');
    }
  }
  for (const l of exp.columns.flatMap((c) => c.lines)) assert.ok(across.includes(`data-src="${l.a.rel} ${l.b.rel}"`), `the pair ${day(l.a)} to ${day(l.b)} is on /across-models/`);
  for (const s of ['build-receipt-pages.js', 'build-site-pages.js', 'build-head-tags.js', 'build-llms.js', 'build-sitemap.js', 'glossary-terms.js']) {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', s), '--check'], { cwd: ROOT, encoding: 'utf8', timeout: 900000 });
    assert.equal(r.status, 0, `${s} --check: ${(r.stderr || r.stdout || '').slice(0, 400)}`);
  }
}, { timeout: 1800000 });

test('AC-9: Chromium at 1280 and 390 px: no sideways scroll, every link an anchor, and nothing fetched off the box', { timeout: 300000 }, async (t) => {
  const { chromium } = require('playwright');
  const shots = fs.mkdtempSync(path.join(process.env.TMPDIR || '/var/tmp', 'did-it-change-742-shots-'));
  const server = http.createServer((req, res) => {
    let file = path.resolve(DOCS, '.' + new URL(req.url, 'http://localhost').pathname);
    if (!file.startsWith(DOCS + path.sep)) return res.writeHead(403).end();
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
    for (const [width, height] of [[1280, 900], [390, 844]]) {
      const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
      const external = [];
      await context.route('**/*', (route) => { if (new URL(route.request().url()).hostname === '127.0.0.1') return route.continue(); external.push(route.request().url()); return route.abort(); });
      const p = await context.newPage();
      await p.goto(`http://127.0.0.1:${server.address().port}${URL_PATH}`, { waitUntil: 'networkidle' });
      assert.equal(await p.locator('section.canary-skill').count(), expected(ROOT).columns.reduce((n, c) => n + c.skills.length, 0));
      assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `no sideways scroll at ${width}`);
      const focusable = await p.evaluate(() => [...document.querySelectorAll('main a[href]')].every((a) => a.tabIndex >= 0));
      assert.ok(focusable, 'every link in main is keyboard reachable');
      assert.deepEqual(external.filter((u) => !u.startsWith('https://static.cloudflareinsights.com/')), [], 'nothing fetched but the analytics tag');
      // A-742-1: every text in main clears 4.5:1 against the surface it sits on; a planted dim line is seen.
      const lowContrast = () => p.evaluate(() => {
        const parse = (c) => { const n = c.match(/[\d.]+/g).map(Number); return c.startsWith('color(') ? { r: n[0] * 255, g: n[1] * 255, b: n[2] * 255, a: n.length > 3 ? n[3] : 1 } : { r: n[0], g: n[1], b: n[2], a: n.length > 3 ? n[3] : 1 }; };
        const bg = (el) => { for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c.a > 0) return c; } return { r: 255, g: 255, b: 255, a: 1 }; };
        const lin = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
        const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
        const out = [];
        for (const el of document.querySelectorAll('main.canary-page h1, main.canary-page h2, main.canary-page h3, main.canary-page p, main.canary-page li, main.canary-page dt, main.canary-page dd, main.canary-page code, main.canary-page b')) {
          if (!el.textContent.trim()) continue;
          const [x, y] = [lum(parse(getComputedStyle(el).color)), lum(bg(el))];
          const ratio = (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
          if (ratio < 4.5) out.push(`${el.tagName.toLowerCase()}.${el.className}: ${ratio.toFixed(2)}`);
        }
        return out;
      });
      assert.deepEqual(await lowContrast(), [], `text under 4.5:1 at ${width}`);
      await p.evaluate(() => { document.querySelector('.canary-setup').style.color = 'rgb(60, 60, 60)'; });
      assert.ok((await lowContrast()).some((x) => x.startsWith('p.canary-setup')), 'plant: a dim line is read');
      await p.evaluate(() => { document.querySelector('.canary-setup').style.color = ''; });
      await p.screenshot({ path: path.join(shots, `did-it-change-${width}.png`), fullPage: true });
      await p.evaluate(() => { const d = document.createElement('div'); d.style.width = '2000px'; d.style.height = '1px'; document.querySelector('main').append(d); });
      assert.ok(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), 'plant: a wide element is detected');
      await context.close();
    }
    t.diagnostic(`screenshots: ${shots}`);
  } finally { if (browser) await browser.close(); await new Promise((resolve) => server.close(resolve)); }
});
