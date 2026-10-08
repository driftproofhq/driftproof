// SPDX-License-Identifier: Apache-2.0
'use strict';

// scripts/report-answers.js: the answer-first summary of a report page (spec 134).
//
// Every report opens with three to five plain sentences. Each names the day, the model by its human
// name, the skill, the figures and what they mean, and links the receipt page they come from
// (`/r/<receipt_hash>/`). Nothing in a sentence is typed: the day, the model, the skill and the
// figures are read from one receipt, the meaning is lib/plain.js's word for that receipt's state
// (spec 128), and the human name is scripts/model-names.js's (spec 133's module). The last sentence
// says what the report does not show, from the same kind of reading.
//
// WHICH RECEIPTS, BY A RULE THAT NEVER LOOKS AT A SCORE (spec 134 R-2). A receipt is eligible when it
// has a receipt page, reads as one result, and every numeral its sentence prints, outside the human
// model name, is already a numeral of the report's own body: the summary restates what the report
// says (spec 020 AC-19) and adds no figure of its own. Then, skills in name order, those every model
// of the report ran first, each skill takes one sentence per model (the report's own model order),
// the latest run of that skill on that model, while the answers stay at four or fewer. The limit
// sentence is read from the first answer's receipt. A rule that picked by score could be tuned to
// the most flattering result; this one cannot.
//
// A RECEIPT THAT DOES NOT RECORD THAT A MODEL ANSWERED gives no sentence (the operator's ruling of
// 1 Oct 2026 on Reports 001 to 008, spec 134 R-7): their findings rest on comparisons no receipt page
// shows, so they open with no answers until a page shows them.
//
// A REPORT RUN MORE THAN ONCE leads with what holds across its runs (the operator's ruling of 1 Oct
// 2026 on Report 013, spec 134 R-9): one sentence per comparison its body reads, saying in how many
// runs the two models differed clearly with the skill loaded. Each count is read from the receipts,
// by the runner's own comparison of each pair, and each sentence links every receipt it counts.
//
// A REPORT WHOSE BODY COMPARES TWO RECEIPTS WITHIN ONE RUN gives no sentence read from one receipt
// (spec 134 R-10, Report 011): its verdicts read
// two receipts' with-skill arms, so a sentence setting one receipt against its own baseline would say
// other than the report shows. It is read from the body's verdict elements, never from a list.
//
// A REPORT WITH NO ELIGIBLE RECEIPT (Report 010 links none) gets no answers here, and the caller
// keeps spec 125's summary for it (spec 134 R-4).
//
// A REPORT THAT COMPARES TWO HARNESSES SHOWS BOTH IN ITS OPENING (the operator's ruling of 2 Oct 2026,
// "Report 009's opening shows both harnesses' results, since the report compares them"). A report the
// data types as an instrument comparison report, and whose evidence holds the native harness's
// aggregate-result files, gains one item before the limit sentence: per skill, the runs that passed
// with the plugin and without it, each figure read from that file and inside a link to it. It is not
// an answer sentence read from a receipt, so it carries no receipt link and no verdict word; the
// opening's Driftproof answers are as they were. The report's body is not touched.
//
// THIS RENDERS, IT DOES NOT RUN: no model call and no network call.

const fs = require('fs');
const path = require('path');
const { humanModelName } = require('./model-names');
const { plainOf, LABELS, CLAUSES } = require('../lib/plain');
const { receiptVerdict } = require('../lib/verdict');
const { buildDriftReport } = require('../lib/diff');
// The runner's no-separation verdict value, taken from its own module rather than typed (spec 031
// A-031-20 keeps that phrase off human-facing text).
const { WITHIN_NOISE } = require('../lib/stats');

const ROOT = path.join(__dirname, '..');
const MAX_ANSWERS = 4;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// The numerals spec 020 AC-19 reads, token against token: a card may carry only a numeral the body
// carries as a numeral in its own right.
const numeralsIn = (t) => [...String(t).matchAll(/[0-9][0-9,]*(?:\.[0-9]+)?\+?/g)].map((m) => m[0].replace(/,+$/, ''));
const textOf = (html) => String(html)
  .replace(/<[^>]*>/g, ' ')
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/\s+/g, ' ');

const n3 = (x) => Number(x).toFixed(3);
// A count of test tasks is a word up to ten, as the reports write it ("seven tasks"); an
// average is a figure. The word is the count's own `<data>` text, and its value is the number.
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const count = (n) => (n >= 0 && n < WORDS.length ? WORDS[n] : String(n));
const joined = (parts) => (parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`);
const dayMonYear = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : null;
};

// What a receipt's state means, in lib/plain.js's words for it. An UNDERPOWERED result reads as spec
// 128's plain label alone, "there were too few answers to tell", as Report 013's amendment one reads
// it (the operator's ruling of 1 Oct 2026, "plain label only"); spec 035's line is met by the receipt
// page the sentence links, which prints it. The label is the result's own, so where spec 143 reads
// the cases disagreeing it is "too few test tasks to tell".
function meaningOf(receipt) {
  const p = plainOf(receipt);
  switch (p.state) {
    case 'PASSED': case 'REGRESSED': return `the skill ${LABELS[p.state].toLowerCase()}`;
    case 'NO_EFFECT': return `there was ${LABELS.NO_EFFECT.toLowerCase()}`;
    case 'UNDERPOWERED': return `there were ${p.label.toLowerCase()}`;
    case 'INCONCLUSIVE': return `the result was ${LABELS.INCONCLUSIVE.toLowerCase()}, because some answers were lost`;
    case 'REPORTED': return 'its numbers were reported, not measured by Driftproof, so it carries no verdict';
    // Spec 145: a receipt recorded before answered_by existed is NOT_MEASURED here, in the site's words,
    // as the receipt pages say it (the view page's label is its own).
    case 'PRE_ANSWERED_BY':
    case 'NOT_MEASURED': return `its receipt carries no verdict, because ${joined((receiptVerdict(receipt).notMeasured || []).map((k) => CLAUSES[k] || k))}`;
    default: return null;
  }
}

// One receipt, read for a sentence: every value the sentence prints, or null where one is missing.
function readingOf(rel, root = ROOT) {
  let r;
  try { r = JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8')); } catch { return null; }
  if (!r || typeof r.receipt_hash !== 'string' || !/^[0-9a-f]{64}$/.test(r.receipt_hash)) return null;
  if (!fs.existsSync(path.join(root, 'docs', 'r', r.receipt_hash, 'index.html'))) return null;
  const run = r.run || {};
  const agg = (r.results || {}).aggregates || {};
  const cmp = r.comparison || {};
  const mean = (mode, alt) => (agg[mode] && typeof agg[mode].mean_score === 'number' ? agg[mode].mean_score : alt);
  const at = String(run.date_utc || '').slice(0, 10);
  const out = {
    rel,
    receipt: r,
    hash: r.receipt_hash,
    stamp: String(run.date_utc || ''),
    date: at,
    day: dayMonYear(at),
    model: run.model_id,
    skill: (r.skill || {}).name,
    with: mean('with_skill', cmp.with_skill_score),
    without: mean('baseline', cmp.baseline_score),
    tasks: agg.with_skill && Number.isInteger(agg.with_skill.case_count) ? agg.with_skill.case_count : null,
  };
  let meaning = null;
  try { meaning = meaningOf(r); } catch { meaning = null; }
  out.meaning = meaning;
  // A receipt that does not record that a model answered gives no sentence (the operator's ruling of
  // 1 Oct 2026): no sentence may claim more than its receipt shows (spec 031).
  let routes = [];
  try { routes = receiptVerdict(r).notMeasured || []; } catch { routes = []; }
  if (routes.includes('no_answered_by')) return null;
  if (!out.day || typeof out.model !== 'string' || typeof out.skill !== 'string' || typeof out.with !== 'number' || typeof out.without !== 'number' || out.tasks === null || !meaning) return null;
  return out;
}

// The model as a reader sees it: its human name where the rule gives one, else the id as code.
// scripts/model-names.js is spec 133's, and it throws on an id its rule cannot name; here that id is
// shown as itself, never guessed.
function modelHtml(id, esc) {
  let name = null;
  try { name = humanModelName(id); } catch { name = null; }
  return name
    ? { html: `<data class="model" value="${esc(id)}">${esc(name)}</data>`, name }
    : { html: `<data class="model" value="${esc(id)}"><code>${esc(id)}</code></data>`, name: null };
}

// ONE LINK SPANS THE CLAIM: from the day to the count of test tasks, every number of the sentence is
// inside its receipt link, and only what the state means stands after it.
const linkOpen = (x, esc) => `<a class="receipt-link" href="/r/${esc(x.hash)}/">`;
const subject = (x, m, esc) => `${m.html} with the <code class="skill">${esc(x.skill)}</code> skill`;
// A run's number, where a report was run more than once: inside the link, beside the day.
const runHtml = (k, esc) => (k == null ? '' : `in run <data class="run" value="${esc(k)}">${esc(k)}</data>, `);
function answerHtml(x, esc) {
  const m = modelHtml(x.model, esc);
  const html = `On ${linkOpen(x, esc)}<time datetime="${esc(x.date)}">${esc(x.day)}</time>, ${subject(x, m, esc)} `
    + `scored <data class="figure" data-at="with_skill" value="${esc(x.with)}">${esc(n3(x.with))}</data> on average, `
    + `and <data class="figure" data-at="baseline" value="${esc(x.without)}">${esc(n3(x.without))}</data> without it, `
    + `over <data class="figure" data-at="tasks" value="${esc(x.tasks)}">${esc(count(x.tasks))}</data> test task${x.tasks === 1 ? '' : 's'}</a>: ${esc(x.meaning)}.`;
  return { html, names: [m.name].filter(Boolean) };
}

// What the report does not show, from what the receipt page prints: the day, the model, the skill
// and the number of test tasks. The page names no grader and no count of scorings, so neither is here.
// On a report run more than once, it says which run its receipt is from (the operator's ruling: a
// single run's figure is named with its run).
function limitHtml(x, esc, run = null) {
  const m = modelHtml(x.model, esc);
  const html = `On ${linkOpen(x, esc)}<time datetime="${esc(x.date)}">${esc(x.day)}</time>, ${runHtml(run, esc)}${subject(x, m, esc)} `
    + `was tested on <data class="figure" data-at="tasks" value="${esc(x.tasks)}">${esc(count(x.tasks))}</data> test task${x.tasks === 1 ? '' : 's'}</a>: `
    + 'it does not show how the skill does on other tasks, or with another grader.';
  return { html, names: [m.name].filter(Boolean) };
}

// Every numeral the sentence prints, outside the human names, is a numeral of the body.
function restates(sentence, bodyNums) {
  let t = textOf(sentence.html);
  for (const n of sentence.names) t = t.split(n).join(' ');
  return numeralsIn(t).every((n) => bodyNums.has(n));
}

// ── across the runs (the operator's ruling of 1 Oct 2026, spec 134 R-9) ─────────────────────────
// THE RUNNER'S OWN COMPARISON OF TWO RECEIPTS, as `driftproof diff` reads it (lib/diff.js
// buildDriftReport), one token per pair. Report 013's builder reads its verdicts through this too, so
// the body and its opening cannot disagree on what a clear difference is.
function pairVerdict(a, b) {
  const rep = buildDriftReport(a, b, { labelA: 'A', labelB: 'B' });
  if (rep.refused || rep.perCase.length !== 1) throw new Error('the runner refused the pair or read other than one case');
  const c = rep.perCase[0];
  const token = c.verdict === 'improvement' ? 'separated-up'
    : c.verdict === 'regression' ? 'separated-down'
      : c.power && c.power.state === 'underpowered' ? 'underpowered'
        : String(c.verdict).startsWith(WITHIN_NOISE) ? 'no-separation' : null;
  if (!token) throw new Error(`the runner read ${c.verdict}, which this page has no label for`);
  return { token, delta: c.delta, power: c.power };
}
const clearly = (token) => token === 'separated-up' || token === 'separated-down';

// The pairs a report's body compares: each verdict element names the two receipts it reads, the
// runner's A first, and the published comparison output.
const VERDICT_EL = /<data value="([^"]*)" data-src="([^"]*)" data-at="results\.cases\[mode=with_skill\]" data-fn="verdict">/g;
const runOf = (rel) => { const m = /(?:^|\/)run-(\d+)\//.exec(rel); return m ? Number(m[1]) : null; };
const reportOf = (rel) => { const m = /(?:^|\/)(?:reports\/|receipts\/report-)(\d{3})\//.exec(rel); return m ? m[1] : null; };
function receiptAt(rel, root) {
  let r;
  try { r = JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8')); } catch { return null; }
  if (!r || typeof r.receipt_hash !== 'string' || !/^[0-9a-f]{64}$/.test(r.receipt_hash)) return null;
  if (!fs.existsSync(path.join(root, 'docs', 'r', r.receipt_hash, 'index.html'))) return null;
  const day = String((r.run || {}).date_utc || '').slice(0, 10);
  return { rel, r, hash: r.receipt_hash, day, model: (r.run || {}).model_id, skill: (r.skill || {}).name, report: reportOf(rel) };
}
const COUNT0 = (n) => (n === 0 ? 'none' : count(n));
const andList = (xs) => (xs.length === 1 ? xs[0] : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
// WHAT CHANGED BETWEEN TWO REPORTS' RUNS (the operator's ruling of 1 Oct 2026, "name the harness
// change"). A receipt does not record the Claude Code version it ran on; the run record beside it does
// (its surface record, `<receipt>.surface.json`, which lib/receipt.js reads as a sidecar when its
// `receipt` names the receipt beside it). Each side's version is read from those records, one value a
// side, and the builder stops where a record is missing, the sides disagree within themselves, or
// nothing changed: then the change is the operator's to name, never guessed here.
function runRecordOf(x, root) {
  const rel = x.rel.replace(/\.json$/, '.surface.json');
  let d;
  try { d = JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8')); } catch { return null; }
  if (!d || d.receipt !== path.basename(x.rel) || d.receipt_hash !== x.hash) return null;
  const v = d.claude_code && d.claude_code.pinned_version;
  if (typeof v !== 'string' || !/^docs\//.test(rel)) return null;
  return { rel, href: `/${rel.slice('docs/'.length)}`, version: v };
}
function oneVersion(xs, root, what) {
  const recs = xs.map((x) => runRecordOf(x, root));
  if (recs.some((r) => !r)) throw new Error(`${what}: a receipt has no published run record that records its Claude Code version; list it for the operator`);
  const vs = [...new Set(recs.map((r) => r.version))];
  if (vs.length !== 1) throw new Error(`${what}: the run records read Claude Code ${JSON.stringify(vs)}, not one version; list it for the operator`);
  return vs[0];
}
const oneDay = (xs, what) => {
  const days = [...new Set(xs.map((x) => x.day))];
  if (days.length !== 1 || !dayMonYear(days[0])) throw new Error(`${what}: the receipts are dated ${JSON.stringify(days)}, not one day`);
  return days[0];
};

// One sentence per comparison, or null where the body's pairs do not span more than one run.
// Every sentence reads: "On {day}, with the skill loaded, {B} differed clearly from {A} on {skills}
// in {n} of [their ]{runs} runs[, and on {skills} in {n} of {runs}][; in {u} of the {m} without a clear
// difference, there were too few answers to tell]." Where every one of more than one run without a
// clear difference had too few answers, the last clause reads "in all {m} without a clear
// difference" (spec 134 A-134-1, pre-review finding 5). Skills that differed clearly
// in as many runs are named together, the most first; a count is a word. The receipts it counts are
// linked under it, run by run, each pair's B first.
// Where A is another report's, the sentence leads with what changed between the two reports' runs,
// the Claude Code version each side's run records give, and keeps the body's caveat: "On {day}, on
// Claude Code {vB} rather than the {vA} of Report {NNN} ({A's day}), with the skill loaded, {B}
// differed clearly from {A} in Report {NNN} ...; the date changed too, so a difference is not put down
// to Claude Code alone." Each pair's run records are linked beside its receipts.
function acrossFor(row, body, { esc, root }) {
  const own = row.number.value;
  const pairs = new Map();
  for (const m of String(body).matchAll(VERDICT_EL)) {
    const [aRel, bRel] = decodeAttr(m[2]).split(' ');
    const key = `${aRel} ${bRel}`;
    if (pairs.has(key) && pairs.get(key).shown !== m[1]) throw new Error(`Report ${own}: the body reads ${key} two ways`);
    pairs.set(key, { aRel, bRel, shown: m[1] });
  }
  if (new Set([...pairs.values()].map((p) => runOf(p.bRel)).filter((k) => k !== null)).size < 2) return null;
  const rowRel = new Map();
  for (const p of (row.receipt_paths || []).map((x) => (typeof x === 'string' ? x : x.value))) {
    const x = receiptAt(p, root);
    if (x && !rowRel.has(x.hash)) rowRel.set(x.hash, p);
  }
  const comps = [];
  for (const p of pairs.values()) {
    const a = receiptAt(p.aRel, root); const b = receiptAt(p.bRel, root);
    if (!a || !b) throw new Error(`Report ${own}: ${!a ? p.aRel : p.bRel} has no receipt page`);
    const run = runOf(p.bRel);
    if (b.report !== own || run === null || a.skill !== b.skill) throw new Error(`Report ${own}: ${p.bRel} against ${p.aRel} is not one skill in one of this report's runs`);
    const { token } = pairVerdict(a.r, b.r);
    if (token !== p.shown) throw new Error(`Report ${own}: the body reads ${p.shown} for ${p.bRel} against ${p.aRel}, the receipts read ${token}`);
    const key = `${a.model}|${a.report}|${b.model}`;
    let c = comps.find((x) => x.key === key);
    if (!c) { c = { key, a, b, pairs: [] }; comps.push(c); }
    c.pairs.push({ skill: a.skill, run, a, b, token });
  }
  if (comps.length + 1 < 3 || comps.length + 1 > 5) throw new Error(`Report ${own}: ${comps.length} comparisons, so ${comps.length + 1} sentences, not 3 to 5`);
  const bodyNums = new Set(numeralsIn(textOf(body)));
  const fig = (at, n, text) => `<data class="figure" data-at="${at}" value="${esc(n)}">${esc(text)}</data>`;
  const skillEl = (s) => `<code class="skill">${esc(s)}</code>`;
  const elsewhere = (x) => (x.report === own ? '' : ` in Report <data class="report" value="${esc(x.report)}">${esc(x.report)}</data>`);
  const answers = comps.map((c) => {
    const per = [...new Set(c.pairs.map((p) => p.skill))].sort().map((s) => {
      const ps = c.pairs.filter((p) => p.skill === s).sort((x, y) => x.run - y.run);
      return { s, ps, clear: ps.filter((p) => clearly(p.token)).length, n: ps.length };
    });
    const groups = [];
    for (const x of [...per].sort((p, q) => q.clear - p.clear || (p.s < q.s ? -1 : 1))) {
      const g = groups.find((y) => y.clear === x.clear && y.n === x.n);
      if (g) g.items.push(x); else groups.push({ clear: x.clear, n: x.n, items: [x] });
    }
    const ordered = groups.flatMap((g) => g.items.flatMap((x) => x.ps));
    const day = oneDay(ordered.flatMap((p) => [p.b, ...(p.a.report === own ? [p.a] : [])]), `Report ${own}`);
    const others = ordered.map((p) => p.a).filter((x) => x.report !== own);
    const dayA = others.length ? oneDay(others, `Report ${own}'s comparison with Report ${others[0].report}`) : null;
    const mA = modelHtml(c.a.model, esc); const mB = modelHtml(c.b.model, esc);
    const ver = (v) => `<data class="version" value="${esc(v)}">${esc(v)}</data>`;
    const vB = dayA ? oneVersion(ordered.map((p) => p.b), root, `Report ${own}'s runs`) : null;
    const vA = dayA ? oneVersion(others, root, `Report ${others[0].report}'s runs`) : null;
    if (dayA && vA === vB) throw new Error(`Report ${own}: the run records give Claude Code ${vA} on both sides, so they do not record what changed; list it for the operator`);
    // the first clause names its unit: "runs", or "their ... runs" where several skills share it
    const clauses = groups.map((g, i) => `on ${andList(g.items.map((x) => skillEl(x.s)))} in ${fig('clear', g.clear * g.items.length, COUNT0(g.clear * g.items.length))} of ${i === 0 && g.items.length > 1 ? 'their ' : ''}${fig('runs', g.n * g.items.length, count(g.n * g.items.length))}${i === 0 ? ' runs' : ''}`);
    const unclear = ordered.filter((p) => !clearly(p.token));
    const few = unclear.filter((p) => p.token === 'underpowered').length;
    const change = dayA ? `on Claude Code ${ver(vB)} rather than the ${ver(vA)} of${elsewhere(c.a).replace(/^ in/, '')} (<time datetime="${esc(dayA)}">${esc(dayMonYear(dayA))}</time>), ` : '';
    let html = `On <time datetime="${esc(day)}">${esc(dayMonYear(day))}</time>, ${change}with the skill loaded, ${mB.html} differed clearly from ${mA.html}`
      + `${dayA ? elsewhere(c.a) : ''} ${joined(clauses)}`;
    if (few && few === unclear.length && few > 1) html += `; in all ${fig('unclear', unclear.length, count(unclear.length))} without a clear difference, there were ${LABELS.UNDERPOWERED.toLowerCase()}`;
    else if (few) html += `; in ${fig('too-few', few, count(few))} of the ${fig('unclear', unclear.length, count(unclear.length))} without a clear difference, there were ${LABELS.UNDERPOWERED.toLowerCase()}`;
    // the body's own caveat, where the two sides are two reports' runs ("The harness check moves more
    // than Claude Code")
    if (dayA) html += '; the date changed too, so a difference is not put down to Claude Code alone';
    html += '.';
    const link = (x) => `<a class="receipt-link" href="/r/${esc(x.hash)}/">${modelHtml(x.model, esc).html}${elsewhere(x)}</a>`;
    // beside each receipt, where the sentence names a change its receipts do not record, the run record it is read from
    const rr = (x) => (dayA ? ` (<a class="run-record" href="${esc(runRecordOf(x, root).href)}">run record</a>)` : '');
    const listed = ordered.map((p) => `${skillEl(p.skill)} run <data class="run" value="${esc(p.run)}">${esc(p.run)}</data>: ${link(p.b)}${rr(p.b)}, ${link(p.a)}${rr(p.a)}`);
    html += ` <details class="receipts"><summary>The receipts it counts</summary>${listed.join('; ')}</details>`;
    const names = [mA.name, mB.name].filter(Boolean);
    if (!restates({ html, names }, bodyNums)) throw new Error(`Report ${own}: a sentence across the runs prints a numeral the body does not`);
    const rels = [...new Set(ordered.flatMap((p) => [p.b, p.a]).map((x) => rowRel.get(x.hash) || x.rel))];
    return { across: true, rels, html, first: ordered[0] };
  });
  // the limit sentence reads the first receipt the first sentence counts, and names its run
  const first = answers[0].first;
  const x = readingOf(rowRel.get(first.b.hash) || first.b.rel, root);
  if (!x) throw new Error(`Report ${own}: ${first.b.rel} does not read for the limit sentence`);
  const limit = { rel: x.rel, html: limitHtml(x, esc, first.run).html };
  if (!restates({ html: limit.html, names: [modelHtml(x.model, esc).name].filter(Boolean) }, bodyNums)) throw new Error(`Report ${own}: the limit sentence prints a numeral the body does not`);
  return { answers: answers.map(({ across, rels, html }) => ({ across, rels, html })), limit };
}
// ── the native harness (the operator's ruling of 2 Oct 2026) ────────────────────────────────────
const INSTRUMENT_COMPARISON = 'Instrument comparison report';
const NATIVE_FILE = /--native--(.+?)--results--aggregate-result\.json$/;
function nativeOf(row, bodyNums, { esc, root }) {
  if (!row.type || row.type.value !== INSTRUMENT_COMPARISON) return null;
  const own = row.number.value;
  const dir = path.join(root, 'docs', 'reports', own, 'evidence');
  let names;
  try { names = fs.readdirSync(dir); } catch { return null; }
  const found = names.map((f) => ({ f, m: NATIVE_FILE.exec(f) })).filter((x) => x.m).map((x) => ({ file: x.f, skill: x.m[1] })).sort((a, b) => (a.skill < b.skill ? -1 : 1));
  if (!found.length) return null;
  for (const x of found) {
    let d;
    try { d = JSON.parse(fs.readFileSync(path.join(dir, x.file), 'utf8')); } catch { throw new Error(`Report ${own}: ${x.file} does not read as JSON`); }
    const c = d.cases || [];
    if (c.length !== 1) throw new Error(`Report ${own}: ${x.file} holds ${c.length} cases, and the opening reads one case per skill`);
    const arm = (k) => { const a = (c[0].arms || {})[k]; if (!Array.isArray(a) || !a.length) throw new Error(`Report ${own}: ${x.file} records no runs for the ${k} arm`); return { runs: a.length, passed: a.filter((r) => r.passed === true).length }; };
    Object.assign(x, { day: String(d.startedAt || '').slice(0, 10), model: (d.suite || {}).modelOverride, cases: c.length, with: arm('with'), without: arm('without') });
  }
  const days = [...new Set(found.map((x) => x.day))];
  const models = [...new Set(found.map((x) => x.model))];
  if (days.length !== 1 || !dayMonYear(days[0])) throw new Error(`Report ${own}: the native files are dated ${JSON.stringify(days)}, not one day`);
  if (models.length !== 1 || typeof models[0] !== 'string') throw new Error(`Report ${own}: the native files name ${JSON.stringify(models)}, not one model`);
  const m = modelHtml(models[0], esc);
  const fig = (at, n, text) => `<data class="figure" data-at="${at}" value="${esc(n)}">${esc(text)}</data>`;
  const clause = (x) => `<a class="evidence-link" href="/reports/${esc(own)}/evidence/${esc(x.file)}"><code class="skill">${esc(x.skill)}</code> passed `
    + `${fig('native-with', x.with.passed, x.with.passed)} of ${fig('native-with-runs', x.with.runs, x.with.runs)} runs with the plugin and `
    + `${fig('native-without', x.without.passed, x.without.passed)} of ${fig('native-without-runs', x.without.runs, x.without.runs)} without it, `
    + `on ${fig('native-cases', x.cases, count(x.cases))} test task</a>`;
  const html = `On <time datetime="${esc(days[0])}">${esc(dayMonYear(days[0]))}</time>, in the plugin eval built into Claude Code, with ${m.html}, ${found.length === 1 ? clause(found[0]) : `${found.slice(0, -1).map(clause).join('; ')}; and ${clause(found[found.length - 1])}`}.`;
  if (!restates({ html, names: [m.name].filter(Boolean) }, bodyNums)) throw new Error(`Report ${own}: the native harness's item prints a numeral the body does not`);
  return { html, files: found.map((x) => `docs/reports/${own}/evidence/${x.file}`) };
}
const decodeAttr = (s) => String(s).replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// The report's answers: { answers: [{ rel, html } | { across, rels, html }], limit: { rel, html } },
// or null. `row` is the report's docs/data/reports.json row; `body` its body, as splitReportBody
// gives it.
function answersFor(row, body, { esc, root = ROOT } = {}) {
  const got = driftproofAnswers(row, body, { esc, root });
  if (!got) return got;
  if (got.across) { const { across, ...rest } = got; return rest; }
  // an instrument comparison report shows the native harness's results too (not for a run-across report)
  const harness = nativeOf(row, new Set(numeralsIn(textOf(body))), { esc, root });
  return harness ? { ...got, harness } : got;
}
function driftproofAnswers(row, body, { esc, root = ROOT } = {}) {
  const across = acrossFor(row, body, { esc, root });
  if (across) return { ...across, across: true };
  // a body that compares two receipts within one run: no sentence read from one receipt (R-10)
  if (new RegExp(VERDICT_EL.source).test(String(body))) return null;
  // a body that counts each model's own result across the runs (data-fn="lift-verdict", Report 014): a sentence
  // read from one receipt would lead with the latest run alone, so it keeps spec 125's summary (spec 134 A-134-6)
  if (/data-fn="lift-verdict"/.test(String(body))) return null;
  const bodyNums = new Set(numeralsIn(textOf(body)));
  const rels = (row.receipt_paths || []).map((p) => (typeof p === 'string' ? p : p.value));
  const eligible = [];
  for (const rel of rels) {
    const x = readingOf(rel, root);
    if (!x) continue;
    const a = answerHtml(x, esc);
    if (restates(a, bodyNums)) eligible.push({ ...x, answer: a });
  }
  const models = (row.model_ids || []).map((m) => (typeof m === 'string' ? m : m.value)).filter((m) => eligible.some((x) => x.model === m));
  const bySkill = new Map();
  for (const x of eligible) {
    if (!models.includes(x.model)) continue;
    const s = bySkill.get(x.skill) || new Map();
    const had = s.get(x.model);
    // the latest run of that skill on that model; a tie goes to the later path
    if (!had || x.stamp > had.stamp || (x.stamp === had.stamp && x.rel > had.rel)) s.set(x.model, x);
    bySkill.set(x.skill, s);
  }
  const names = [...bySkill.keys()].sort();
  const full = names.filter((s) => bySkill.get(s).size === models.length);
  const rest = names.filter((s) => bySkill.get(s).size !== models.length).sort((a, b) => bySkill.get(b).size - bySkill.get(a).size || (a < b ? -1 : 1));
  const picked = [];
  for (const s of [...full, ...rest]) {
    const group = models.filter((m) => bySkill.get(s).has(m)).map((m) => bySkill.get(s).get(m));
    if (picked.length && picked.length + group.length > MAX_ANSWERS) break;
    picked.push(...group.slice(0, MAX_ANSWERS - picked.length));
    if (picked.length >= MAX_ANSWERS) break;
  }
  // the limit sentence reads the first answer's receipt; it prints no numeral that answer does not
  const limit = picked.length ? { rel: picked[0].rel, html: limitHtml(picked[0], esc).html } : null;
  if (!limit || !restates({ html: limit.html, names: picked[0].answer.names }, bodyNums) || picked.length + 1 < 3) return null;
  return { answers: picked.map((x) => ({ rel: x.rel, html: x.answer.html })), limit };
}

module.exports = { answersFor, pairVerdict, meaningOf, MAX_ANSWERS };
