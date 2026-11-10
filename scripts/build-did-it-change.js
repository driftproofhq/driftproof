#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';
// Site builder: {"href":"/did-it-change/","label":"Did the AI change?"}
// Issue 742 (spec 742): /did-it-change/, "Did the AI change?". The same skills with the same frozen tests,
// run again on the same model on a later date, pair by pair. The page reads receipts/canary/manifest.json
// and the receipts it names, and nothing else: each receipt validated and verified before anything is
// rendered, each pair refused unless its two receipts are alike on spec 731's group key and bound to the
// manifest's source digest and suite file by hash. Between each two receipts is the headline
// lib/diff.js buildDriftReport gives the pair in release mode, byte for byte in an attribute and, to the
// reader, with its label word rewritten by one fixed mapping the key shows. The headline above the rows
// counts those readings and nothing else. Nothing here calls a model, fetches anything or writes a receipt.
//   node scripts/build-did-it-change.js [--check]
const fs = require('node:fs'), path = require('node:path');
const C = require('../specs/408-skill-measurements/campaign.cjs');
const { readReceiptFile, validateReceipt, verifyReceiptHash } = require('../lib/receipt');
const { buildDriftReport } = require('../lib/diff');
const { suiteIdentity } = require('../lib/skill');
const { canonicalModelId } = require('../lib/usage');
const { groupKeyOf } = require('./model-drift-page.js');
const { applyHeadTags } = require('./build-head-tags');
const { humanModelName } = require('./model-names');
const ROOT = path.join(__dirname, '..');
const REL = 'did-it-change/index.html', URL_PATH = '/did-it-change/';
const MANIFEST = 'receipts/canary/manifest.json';
const MANIFEST_FORMAT = 'driftproof-canary/1';
const MANIFEST_MAX_BYTES = 1 << 20;
const SPEC408 = 'specs/408-skill-measurements';
const esc = C.esc, need = C.need;

// The page's own words (spec 742 § Page texts). The lede is also the description the head builder derives.
const WORDS = {
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
  // A-742-1: fixed words with no receipt data in them, so the code elements are written here.
  yours: [
    'In Claude Code, type <code>/driftproof:recheck</code> and the path to your file. The first use saves a copy of your file, its tests and its run settings and runs nothing. Each later use runs that saved copy and keeps another dated receipt, and a recheck compares each new result with the previous one and with the first saved reading. It cannot compare with a date before you saved.',
    'From a terminal, the same steps are <code>driftproof recheck init --trusted-skill</code> (only for a file you wrote yourself), <code>driftproof recheck run --trusted-skill</code> on each later date (you give that flag each time; the saved copy does not keep it) and <code>driftproof recheck history</code> for the comparisons.',
    'This checks Claude through Claude Code with fixed tasks, not anyone&#39;s chat history.',
    'Every pair of receipts this site holds for the same skill, the same tests, the same model, the same judge model and the same setup (how each answer was recorded and which sides of the comparison ran) on different dates is listed on ',
  ],
  acrossModels: 'The same skill on different models and dates',
  caution: (n) => ['Across these ', n, ' test tasks, chance alone can produce some separations under this rule, because each task\'s band comes from a few answers. This page does not say whether a separation here came from chance or from anything else.'],
  modelLine: 'A receipt names the model but cannot show whether what stands behind that name changed.',
  // A-742-2 (issue 765): each model's summary names Driftproof's own version and scoring code as a possible cause.
  summaryCauses: 'Driftproof\'s own version and scoring code could have moved these scores too, so a separation here cannot be put down to the model alone.',
  // A-742-2 (issue 765): what moved in each pair, in plain words.
  moved: {
    none: 'On no task did the answers with the skill score clearly higher or lower.',
    noVerdict: 'Nothing can be said about what moved in this pair.',
    task: (task, word, b, a) => ['On the ', task, ` task, the answers with the skill scored ${word} on `, b, ' than on ', a, ', by more than their usual spread.'],
    reconcile: 'The averages in the rows on either side cover all of this skill\'s tasks, so they can move the other way, and here they do.',
  },
};
// A-742-1: the recorded fields that can differ between the two receipts of a pair.
const MOVED_FIELDS = [['runner', 'run.runner_version'], ['code', 'run.judge.code_revision'], ['harness', 'run.harness.version']];
// The fixed mapping (spec 742 AC-4): each label lib/diff.js prints, its plain words, its reading. A label
// outside this table refuses the build, so a new differ label never reaches the page unmapped.
const MAPPING = [
  { label: 'NO SEPARATION DETECTED', plain: 'No separation detected', reading: 'none' },
  { label: 'DRIFT', plain: 'A separation detected on a task, with the skill lower on the later date', reading: 'separation' },
  { label: 'IMPROVED', plain: 'A separation detected on a task, with the skill higher on the later date', reading: 'separation' },
  { label: 'MIXED', plain: 'A separation detected, lower on some tasks and higher on others', reading: 'separation' },
  { label: 'INCONCLUSIVE', plain: 'Inconclusive', reading: 'no-verdict' },
  { label: 'NOT MEASURED', plain: 'Not measured', reading: 'no-verdict' },
  { label: 'REFUSED', plain: 'Refused', reading: 'no-verdict' },
];
const READINGS = ['none', 'separation', 'no-verdict'];
const NUMBER_WORDS = ['none', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const W = (n) => (n < NUMBER_WORDS.length ? NUMBER_WORDS[n] : String(n));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const and = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const get = (o, p) => p.split('.').reduce((v, k) => (v === undefined || v === null ? undefined : v[k]), o);
const day = (x) => String(x.receipt.run.date_utc).slice(0, 10);
const daysOf = (x) => Math.round(Date.parse(`${day(x)}T00:00:00Z`) / 86400000);
const n3 = (v) => Number(v).toFixed(3);

// A manifest path: relative, under receipts/, no empty, dot or dot-dot segment, a JSON file.
function manifestPath(p) {
  need(typeof p === 'string' && !path.isAbsolute(p) && !p.includes('\\'), 'MANIFEST_PATH');
  const parts = p.split('/');
  need(parts.length >= 2 && parts[0] === 'receipts' && parts.every((s) => s !== '' && s !== '.' && s !== '..') && p.endsWith('.json'), 'MANIFEST_PATH');
  return p;
}
function readManifest(root) {
  const file = path.join(root, MANIFEST);
  need(fs.existsSync(file) && fs.statSync(file).size <= MANIFEST_MAX_BYTES, 'MANIFEST_FORMAT');
  let m; try { m = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { C.fail('MANIFEST_FORMAT'); }
  need(m && typeof m === 'object' && m.format === MANIFEST_FORMAT && typeof m.rule === 'string' && m.rule.length > 0 && Array.isArray(m.pairs), 'MANIFEST_FORMAT');
  need(m.pairs.length > 0, 'MANIFEST_EMPTY');
  for (const p of m.pairs) need(p && typeof p === 'object' && ['skill', 'repository', 'commit', 'skill_sha256', 'suite', 'before', 'after'].every((k) => typeof p[k] === 'string' && p[k].length > 0), 'MANIFEST_FORMAT');
  return m;
}
// Spec 742 AC-2: a receipt is read within readReceiptFile's bounds, validated and verified, once per path.
function receiptReader(root) {
  const seen = new Map();
  return (rel) => {
    manifestPath(rel);
    if (!seen.has(rel)) {
      const receipt = readReceiptFile(path.join(root, rel));
      need(validateReceipt(receipt).valid, 'RECEIPT_INVALID');
      need(verifyReceiptHash(receipt), 'RECEIPT_SEAL');
      seen.set(rel, { rel, receipt });
    }
    return seen.get(rel);
  };
}
// Whether the judge is the model measured: spec 639 AC-8's rule (a sealed within-model relationship,
// else whether a judge model has the canonical id of run.model_id).
function judgeSelf(r) {
  const s = get(r, 'run.judge.relationship');
  if (s && s.comparison_scope === 'within-model' && typeof s.same_model === 'boolean') return s.same_model;
  const rows = ((r.results || {}).cases || []).filter((c) => c.mode === 'with_skill' || c.mode === 'baseline');
  const judges = rows.map((c) => get(c, 'judge.model_id') ?? get(r, 'run.judge.model_id')).filter((j) => j !== undefined && j !== null);
  return judges.some((j) => canonicalModelId(j) === canonicalModelId(r.run.model_id));
}
// The pair's headline: the first non-empty line under "## Headline" of the differ's markdown, its bold
// markers off, split at its label and mapped (spec 742 AC-4). The differ's own throw refuses the build.
function mapHeadline(text) {
  const m = /^([A-Z][A-Z ]*[A-Z])(?:: | — )([\s\S]*)$/.exec(String(text));
  const entry = m && MAPPING.find((e) => e.label === m[1]);
  need(entry, 'HEADLINE_LABEL');
  return { label: entry.label, rest: m[2], plain: entry.plain, reading: entry.reading };
}
function pairHeadline(a, b) {
  const rep = buildDriftReport(a.receipt, b.receipt, { labelA: day(a), labelB: day(b), mode: 'release' });
  const ls = rep.markdown.split('\n');
  const i = ls.findIndex((l) => /^## Headline\s*$/.test(l));
  const line = i < 0 ? null : (ls.slice(i + 1).find((l) => l.trim()) || null);
  need(line !== null, 'HEADLINE_MISSING');
  const text = line.trim().replace(/^\*\*/, '').replace(/\*\*$/, '');
  return { text, ...mapHeadline(text), refusal: rep.refusal_key || null, perCase: rep.perCase };
}

// A-742-2 (issue 765): the differ's separated tasks, and the plain word for which way a task moved.
const separatedOf = (l) => l.perCase.filter((c) => c.verdict === 'regression' || c.verdict === 'improvement');
const wordOf = (c) => (c.verdict === 'regression' ? 'lower' : 'higher');

// A-742-1: per field, the pairs whose two receipts record different values, and the pairs where a receipt
// records none, which count as neither the same nor different.
function movedCounts(lines) {
  const absent = (v) => v === undefined || v === null;
  return Object.fromEntries(MOVED_FIELDS.map(([k, p]) => {
    const vals = lines.map((l) => [get(l.a.receipt, p), get(l.b.receipt, p)]);
    return [k, { differ: vals.filter(([x, y]) => !absent(x) && !absent(y) && x !== y).length, unrecorded: vals.filter(([x, y]) => absent(x) || absent(y)).length }];
  }));
}

// The pairs (spec 742 AC-1): each bound to its source and suite, alike on the group key, in date order;
// then the columns by model and the skill lists in manifest order, each a chain of adjacent pairs.
function pairsOf(opts = {}) {
  const root = opts.root || ROOT, docsDir = opts.docsDir || path.join(root, 'docs');
  const manifest = readManifest(root);
  const load = receiptReader(root);
  const sources = JSON.parse(fs.readFileSync(path.join(root, SPEC408, 'sources.json'), 'utf8'));
  const suites = new Map();
  const suiteHash = (rel) => {
    need(/^suites\/[A-Za-z0-9._-]+\.json$/.test(rel), 'SUITE_BINDING');
    if (!suites.has(rel)) {
      const file = path.join(root, SPEC408, rel);
      need(fs.existsSync(file), 'SUITE_BINDING');
      let hash; try { hash = suiteIdentity(JSON.parse(fs.readFileSync(file, 'utf8'))).suiteHash; } catch { C.fail('SUITE_BINDING'); }
      suites.set(rel, hash);
    }
    return suites.get(rel);
  };
  const pairs = manifest.pairs.map((p) => {
    const a = load(p.before), b = load(p.after);
    need(a.receipt.skill.name === p.skill && b.receipt.skill.name === p.skill, 'SKILL_BINDING');
    need(sources.some((s) => s.repository === p.repository && s.skill === p.skill && s.commit === p.commit && s.skill_sha256 === p.skill_sha256 && s.suite === p.suite), 'SOURCE_BINDING');
    // Alike first: two receipts that differ on any group-key field are two measurements, whatever else holds.
    const ka = groupKeyOf(a.receipt), kb = groupKeyOf(b.receipt);
    need(ka !== null && ka === kb, 'PAIR_UNLIKE');
    need(cmp(a.receipt.run.date_utc, b.receipt.run.date_utc) < 0, 'PAIR_ORDER');
    const h = suiteHash(p.suite);
    need(h === a.receipt.suite.suite_hash && h === b.receipt.suite.suite_hash, 'SUITE_BINDING');
    for (const x of [a, b]) {
      const page = path.join(docsDir, 'r', x.receipt.receipt_hash, 'index.html');
      need(fs.existsSync(page) && fs.readFileSync(page, 'utf8').includes(x.receipt.receipt_hash), 'RECEIPT_PAGE');
    }
    return { ...p, a, b };
  });
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
      need(s.pairs.length === s.rows.length - 1, 'CHAIN');
      s.lines = s.rows.slice(1).map((b, i) => {
        const a = s.rows[i];
        need(s.pairs.some((p) => p.a === a && p.b === b), 'CHAIN');
        return { a, b, ...pairHeadline(a, b) };
      });
    }
    const rows = skills.flatMap((s) => s.rows), lines = skills.flatMap((s) => s.lines);
    const selves = [...new Set(rows.map((x) => judgeSelf(x.receipt)))];
    need(selves.length === 1, 'JUDGE_MIXED');
    const gaps = [...new Set(lines.map((l) => daysOf(l.b) - daysOf(l.a)))];
    const counts = Object.fromEntries(READINGS.map((r) => [r, lines.filter((l) => l.reading === r).length]));
    const separations = skills.flatMap((s) => s.lines.filter((l) => l.reading === 'separation').flatMap((l) => separatedOf(l).map((c) => ({ skill: s.name, task: c.id, word: wordOf(c) }))));
    return {
      model, name: humanModelName(model), judge: selves[0] ? 'same' : 'other', skills, rows, lines,
      tasks: skills.reduce((n, s) => n + s.rows[0].receipt.suite.case_count, 0), moved: movedCounts(lines),
      dates: [...new Set(rows.map(day))].sort(), gap: gaps.length === 1 && gaps[0] >= 1 ? gaps[0] : null,
      counts: { ...counts, skills: skills.length, pairs: lines.length }, separations,
      first: rows.map((x) => x.receipt.run.date_utc).sort()[0],
    };
  }).sort((a, b) => cmp(a.first, b.first) || cmp(a.model, b.model));
  return { manifest, columns };
}

// ── rendering ─────────────────────────────────────────────────────────────────────────────────────
const bound = (x, at, value, text = String(value)) => `<data value="${esc(String(value))}" data-src="${esc(x.rel)}" data-at="${esc(at)}">${esc(text)}</data>`;
function armHTML(x, arm) {
  const r = x.receipt;
  if (r.run && r.run.status === 'incomplete') return WORDS.notMeasured;
  const a = get(r, `results.aggregates.${arm}`) || {};
  if (typeof a.mean_score !== 'number') return WORDS.notMeasured;
  const mean = bound(x, `results.aggregates.${arm}.mean_score`, a.mean_score, n3(a.mean_score));
  return typeof a.stddev === 'number' ? `${mean} ± ${bound(x, `results.aggregates.${arm}.stddev`, a.stddev, n3(a.stddev))}` : `${mean} ${WORDS.noBand}`;
}
function harnessHTML(x) {
  const h = get(x.receipt, 'run.harness');
  if (!h || typeof h.name !== 'string') return WORDS.harnessNone;
  const version = h.version !== undefined && h.version !== null ? ` ${bound(x, 'run.harness.version', h.version)}` : '';
  return `harness ${bound(x, 'run.harness.name', h.name)}${version}`;
}
function rowHTML(x) {
  const h = x.receipt.receipt_hash;
  return `<li class="canary-row" data-receipt="${h}"><a href="/r/${h}/"><span data-date>${esc(day(x))}</span></a>: Driftproof ${bound(x, 'run.runner_version', x.receipt.run.runner_version)}, ${harnessHTML(x)}. With the skill ${armHTML(x, 'with_skill')}, without it ${armHTML(x, 'baseline')}.</li>`;
}
// AC-13 (issue 765): what moved in the pair, in plain words, from the differ's per-case table and the
// two receipts' with-skill averages. Each date is bound to its receipt; the task names are the differ's.
function whatMovedHTML(l) {
  if (l.reading !== 'separation') return esc(l.reading === 'none' ? WORDS.moved.none : WORDS.moved.noVerdict);
  const tasks = separatedOf(l);
  need(tasks.length > 0, 'PAIR_MOVED');
  const date = (x) => bound(x, 'run.date_utc', x.receipt.run.date_utc, day(x));
  const sentences = tasks.map((c) => WORDS.moved.task(`<span data-quote="name">${esc(c.id)}</span>`, wordOf(c), date(l.b), date(l.a)).join(''));
  const avg = (x) => get(x.receipt, 'results.aggregates.with_skill.mean_score');
  // The averages as the rows print them, so the sentence never contradicts what a reader sees.
  const shown = (x) => Number(n3(avg(x)));
  const opposite = typeof avg(l.a) === 'number' && typeof avg(l.b) === 'number' && tasks.some((c) => (c.verdict === 'regression' ? shown(l.b) > shown(l.a) : shown(l.b) < shown(l.a)));
  return [...sentences, ...(opposite ? [esc(WORDS.moved.reconcile)] : [])].join(' ');
}
function pairHTML(l) {
  return `<li class="canary-pair" data-src="${esc(`${l.a.rel} ${l.b.rel}`)}" data-fn="${WORDS.fn}" data-headline="${esc(l.text)}" data-label="${esc(l.label)}" data-reading="${l.reading}"${l.refusal ? ` data-refusal="${esc(l.refusal)}"` : ''}>Comparing <span data-date>${esc(day(l.a))}</span> with <span data-date>${esc(day(l.b))}</span>: <span data-what-moved="${l.reading}">${whatMovedHTML(l)}</span> Driftproof read: <b data-plain>${esc(l.plain)}</b>: <span data-rest data-quote="text">${esc(l.rest)}</span></li>`;
}
function headlineHTML(c) {
  const count = (k, n, text) => `<data value="${n}" data-count="${k}">${esc(text)}</data>`;
  const dates = and(c.dates.map((d) => `<span data-date>${esc(d)}</span>`));
  const gap = c.gap !== null ? `, ${count('days', c.gap, `${W(c.gap)} day${c.gap === 1 ? '' : 's'}`)} apart` : '';
  const quoted = (s) => `<span data-quote="name">${esc(s)}</span>`;
  const sep = c.separations.length ? ` (${c.separations.map((x) => `${quoted(x.skill)}: on the ${quoted(x.task)} task, the answers with the skill scored ${x.word} on the later date`).join('; ')})` : '';
  // A-742-2 (issue 765): a clause of zero is left out; with no refused or unmeasured pair the headline says every pair got a reading.
  const clauses = [
    ...(c.counts.none ? [`no separation detected on ${count('none', c.counts.none, W(c.counts.none))}`] : []),
    ...(c.counts.separation ? [`a separation detected on ${count('separation', c.counts.separation, W(c.counts.separation))}${sep}`] : []),
    ...(c.counts['no-verdict'] ? [`no verdict on ${count('no-verdict', c.counts['no-verdict'], W(c.counts['no-verdict']))}`] : ['and every pair got a reading']),
  ];
  return `<p class="canary-headline" data-pairs="${c.counts.pairs}" data-none="${c.counts.none}" data-separation="${c.counts.separation}" data-no-verdict="${c.counts['no-verdict']}">${count('skills', c.counts.skills, cap(W(c.counts.skills)))} popular skills, the same tests, ${dates} on <span data-model-name>${esc(c.name)}</span>${gap}: ${clauses.join(', ')}.</p>`;
}
// AC-11: on every column, whatever it reads, so a column without a separation does not read as cleared.
function cautionHTML(c) {
  const [before, n, after] = WORDS.caution(`<data value="${c.tasks}" data-count="tasks">${esc(W(c.tasks))}</data>`);
  return `<p class="canary-caution">${esc(before)}${n}${esc(after)}</p>`;
}
// AC-12: which recorded versions differ between the dates, counted by rule over the column's pairs.
function movedHTML(c) {
  const count = (k, n) => `<data value="${n}" data-moved="${k}">${esc(W(n))}</data>`;
  const bit = (k) => `${count(k, c.moved[k].differ)}${c.moved[k].unrecorded ? ` (not recorded on ${count(`${k}-unrecorded`, c.moved[k].unrecorded)})` : ''}`;
  return `<p class="canary-moved">Of the ${count('pairs', c.counts.pairs)} pair${c.counts.pairs === 1 ? '' : 's'} below, the receipts record a different version of Driftproof on ${bit('runner')}, a different revision of its scoring code on ${bit('code')} and a different version of the harness on ${bit('harness')}. ${esc(WORDS.modelLine)}${c.moved.runner.differ + c.moved.code.differ + c.moved.runner.unrecorded + c.moved.code.unrecorded > 0 ? ` ${esc(WORDS.summaryCauses)}` : ''}</p>`;
}
function skillHTML(s) {
  const L = [`<section class="canary-skill" data-subject="${esc(s.subject)}" data-suite="${esc(s.suiteHash)}">`];
  L.push(`<h3 data-skill-name>${esc(s.name)}</h3>`);
  L.push(`<p class="canary-source" data-src="${MANIFEST}">From <span data-repository>${esc(s.repository)}</span> at <code data-commit>${esc(s.commit.slice(0, 8))}</code>; the tests are <code data-suite-file>${esc(path.basename(s.suite))}</code>.</p>`);
  L.push('<ol class="canary-rows">');
  s.rows.forEach((x, i) => { if (i) L.push(pairHTML(s.lines[i - 1])); L.push(rowHTML(x)); });
  L.push('</ol>');
  L.push('</section>');
  return L.join('\n');
}
function columnHTML(c) {
  return [
    `<section class="canary-model" data-model="${esc(c.model)}">`,
    `<h2>On <span data-model-name>${esc(c.name)}</span></h2>`,
    headlineHTML(c),
    cautionHTML(c),
    `<p class="canary-setup">${esc(WORDS.setup)} <span data-judge="${c.judge}">${esc(WORDS.judge[c.judge])}</span></p>`,
    movedHTML(c),
    ...c.skills.map(skillHTML),
    '</section>',
  ].join('\n');
}
function pageHtml({ manifest, columns }) {
  const p = (text, cls) => `<p${cls ? ` class="${cls}"` : ''}>${esc(text)}</p>`;
  need(WORDS.lede.length >= 50 && WORDS.lede.length <= 155, 'DESCRIPTION');
  const main = ['<main class="canary-page">',
    `<h1>${esc(WORDS.h1)}</h1>`, p(WORDS.lede, 'lede'),
    '<h2 id="what">What this is</h2>', ...WORDS.what.slice(0, 3).map((t) => p(t, 'canary-what')),
    `<p class="canary-what">${esc(WORDS.what[3])} <q data-src="${MANIFEST}" data-at="rule">${esc(manifest.rule).replace(/\bReport (\d{3})\b/, '<a href="/reports/$1/">Report $1</a>')}</q></p>`,
    ...columns.map(columnHTML),
    '<h2 id="key">How to read this page</h2>', ...WORDS.key.map((k, i) => `<p class="canary-key" data-key="${i + 1}">${esc(k)}</p>`),
    '<dl class="canary-map">', ...MAPPING.map((m) => `<dt><code data-differ-label="${esc(m.label)}">${esc(m.label)}</code></dt>\n<dd data-reading="${m.reading}">${esc(m.plain)}</dd>`), '</dl>',
    '<h2 id="yours">Do this for your own file</h2>',
    ...WORDS.yours.slice(0, -1).map((y) => `<p>${y}</p>`),
    `<p>${WORDS.yours[WORDS.yours.length - 1]}<a href="/across-models/">${esc(WORDS.acrossModels)}</a>.</p>`,
    '</main>'].join('\n');
  const raw = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(WORDS.h1)} | Driftproof</title><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="${URL_PATH}style.css"></head><body>${main}</body></html>\n`;
  // A second application normalizes the inserted chrome's boundary whitespace, as for Report 017.
  return applyHeadTags(applyHeadTags(raw, REL), REL);
}

function pageOf(opts = {}) {
  const data = pairsOf(opts);
  return { html: pageHtml(data), data };
}
function outputs(opts = {}) {
  const out = path.resolve(opts.out || path.join(opts.root || ROOT, 'docs'));
  return [{ file: path.join(out, REL), text: pageOf(opts).html }];
}
function write(opts = {}) {
  const files = outputs(opts);
  for (const f of files) { fs.mkdirSync(path.dirname(f.file), { recursive: true }); fs.writeFileSync(f.file, f.text); }
  return files;
}
function check(opts = {}) {
  const files = outputs(opts);
  for (const f of files) need(fs.existsSync(f.file) && fs.readFileSync(f.file, 'utf8') === f.text, 'DID_IT_CHANGE_DRIFT');
  return files;
}
function main(argv = process.argv.slice(2)) {
  for (const a of argv) if (a !== '--check') C.fail('ARGUMENT');
  const isCheck = argv.includes('--check');
  const files = (isCheck ? check : write)();
  const n = (files[0].text.match(/<li class="canary-pair"/g) || []).length;
  console.log(`did-it-change: the page ${isCheck ? 'matches' : 'written from'} the manifest and its receipts, ${n} pairs`);
}
module.exports = { REL, URL_PATH, MANIFEST, WORDS, MAPPING, manifestPath, readManifest, judgeSelf, mapHeadline, pairHeadline, movedCounts, movedHTML, whatMovedHTML, pairHTML, pairsOf, pageHtml, pageOf, outputs, write, check, main };
if (require.main === module) try { main(); } catch (e) { console.error(`did-it-change: refused: ${e.code || e.message}`); process.exitCode = 1; }
