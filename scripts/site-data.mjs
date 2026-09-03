#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// scripts/site-data.mjs — the site's data layer (spec 020 AC-5, AC-6).
//
// EVERY FIGURE THE SITE PRINTS OUTSIDE A REPORT BODY COMES FROM HERE, and every
// field carries the path it was derived from. The homepage used to say "tens of
// thousands of skills are shared publicly", which was true of nothing anybody
// could check; CONSTITUTION invariant 1 says every published number carries a
// receipt, and a front page is a published surface like any other.
//
// TWO KINDS OF `from`, and the difference is stated rather than left to a
// reader. A FILE means the value is still findable in that file, and the spec
// gate asserts exactly that. A DIRECTORY means the value is a count or a
// selection over that directory's contents, where there is nothing to find
// inside a single file; the gate asserts the directory exists and stops there.
//
// The ONE hand-recorded input is docs/data/sources.json, and it is a citation,
// not a measurement: nothing in this repository can derive how many skills an
// external index holds. It carries a URL and a read date so a reader can check.
//
//   node scripts/site-data.mjs             write docs/data/*.json
//   node scripts/site-data.mjs --out DIR   write somewhere else
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { receiptFiles, keyOf, cellOf } from './band-plot.mjs';

const require = createRequire(import.meta.url);
const { DEFAULT_JUDGE_SAMPLES, EFFECT_FLOOR } = require('../config.js');

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = path.join(ROOT, 'docs');
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const F = (value, from) => ({ value, from });

// Text extraction, deliberately the SAME shape the spec gate uses to verify it.
// Two copies that must agree, rather than one import that could make the check
// agree with the thing it checks by construction.
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', hellip: '…', mdash: '—', ndash: '–', times: '×', plusmn: '±' };
const decode = (s) => String(s)
  .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
  .replace(/&#x([0-9a-fA-F]+);/g, (_m, d) => String.fromCodePoint(parseInt(d, 16)))
  .replace(/&([a-z]+);/g, (m, n) => (ENT[n] !== undefined ? ENT[n] : m));
const textOf = (h) => decode(String(h)
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').replace(/\s+([.,;:!?])/g, '$1').trim();

// A prefix, never a paraphrase. Cut before any em dash so the value can be
// rendered into a template the em-dash rule binds, and cut on a word boundary so
// it stays a quotation of the page rather than a mangling of it.
function prefix(s, cap) {
  let out = String(s).split(' — ')[0].split(' – ')[0].trim();
  if (out.length <= cap) return out;
  out = out.slice(0, cap);
  const at = out.lastIndexOf(' ');
  // THE ELLIPSIS IS NOT DECORATION (F-020-B). Cutting at a word boundary and
  // stripping the trailing comma produces a string that reads as a finished
  // clause and is not one: report 005 shipped "...with separated bands: 18 with
  // an" on the reports index, in the TL;DR card and in llms.txt. The twin of
  // this function, clamp() in build-head-tags.js, has always appended one, and
  // its comment gives the reason invariant 1 gives — a truncated claim is one
  // nobody can check. A cut that is not marked as a cut is the worse failure,
  // because nothing downstream can tell it from the whole sentence.
  return `${(at > cap * 0.5 ? out.slice(0, at) : out).replace(/[\s,;:(]+$/, '')}…`;
}
const firstSentence = (s) => {
  const m = String(s).match(/^[\s\S]*?[.?!](?=\s|$)/);
  return (m ? m[0] : String(s)).trim();
};
const sentencesOf = (s) => {
  const out = [];
  let rest = String(s).trim();
  while (rest) {
    const m = rest.match(/^[\s\S]*?[.?!](?=\s|$)/);
    if (!m) { out.push(rest); break; }
    out.push(m[0].trim());
    rest = rest.slice(m[0].length).trim();
  }
  return out;
};

// THE REPORT'S OWN VERDICT LINE, WHICH IS NOT ITS SUMMARY.
//
// The TL;DR card used to derive VERDICT and HEADLINE from the same sentence, so
// on Report 007 it printed one string twice under two labels. These reports put
// their summary in the first sentence of the headline block and their FINDING in
// a later emphasised one - "At the cell level no effect separates from noise" on
// 007, "14 cleared the floor on aggregate" on 005 - so that is the rule: the
// first sentence after the opening one that carries emphasis.
//
// A report whose only emphasised sentence IS its opening one has no separate
// verdict line, and gets none. Rendering the summary again under a VERDICT label
// is a claim the report did not make twice.
//
// A PREFIX, NEVER A PARAPHRASE, exactly like every other value derived here: the
// result is still a substring of the page's own text, which is what lets AC-6
// find it in the file it cites. So no punctuation is added, only removed.
function verdictLine(bigHtml, pageHtml = '') {
  // AN EXPLICIT VERDICT BEATS THE HEURISTIC BELOW, and is preferred where a page
  // carries one. The emphasis rule was written for reports 001-007, none of which
  // states its finding anywhere but in the headline block, so it had to infer the
  // verdict from where the emphasis fell. Report 008 puts its conclusion in its
  // own `<p class="verdict">` block, which is the report SAYING which sentence is
  // the verdict rather than this function guessing. Where that block exists it is
  // the answer, and where it does not nothing changes: no page 001-007 carries
  // one, so every row derived before this preference existed is byte-identical
  // after it.
  //
  // A PREFIX, NEVER A PARAPHRASE, on the same terms as the rest of this file: the
  // trailing full stop is REMOVED and nothing is added, so the value stays a
  // substring of the page's own text and AC-6 can still find it in the file it
  // cites.
  const explicit = /<p class="verdict">\s*<strong>([\s\S]*?)<\/strong>/.exec(String(pageHtml));
  if (explicit) {
    const stated = textOf(explicit[1]).replace(/[.\s]+$/, '').trim();
    if (stated.length > 3) return stated;
  }
  const emphasis = [...String(bigHtml).matchAll(/<(strong|em)\b[^>]*>([\s\S]*?)<\/\1>/g)]
    .map((m) => textOf(m[2])).filter((t) => t.length > 3);
  const later = sentencesOf(textOf(bigHtml)).slice(1);
  const hit = later.find((sentence) => emphasis.some((e) => sentence.includes(e)));
  if (!hit) return '';
  let out = hit.split(' \u2014 ')[0].split(' \u2013 ')[0].trim();
  // A cut at an em dash can leave a clause with nothing to attach to.
  out = out.replace(/,\s+(?:and|or|but|which|while|where|who)\b[^,]*$/i, '');
  if (out.length > 200) {
    out = out.slice(0, 200);
    const at = out.lastIndexOf(' ');
    if (at > 100) out = out.slice(0, at);
  }
  // Never half a figure: pull back out of a parenthetical the cap landed inside.
  const open = out.lastIndexOf('(');
  if (open > -1 && out.indexOf(')', open) === -1) out = out.slice(0, open);
  return out.replace(/[\s,;:(+\u00b1-]+$/, '');
}
// THE MODEL ID, IN FULL (fix pass R5). It used to lose its vendor prefix as well
// as its date suffix, so a receipt recording `claude-fable-5` was published as
// `fable-5`. On a site whose whole claim is that a number traces to a file, the
// model IS the number, and a shortened id is a different string from the one in
// the receipt. Only the release date comes off, because that is a property of
// the pin and not of the model: `claude-haiku-4-5-20251001` is `claude-haiku-4-5`.
const modelId = (id) => String(id).replace(/-\d{8}$/, '');

// The bundled example receipt: the one docs/badges/commit-message-conventions.json
// was cut from, and therefore the one a reader can check against the badge on
// the page beside it.
const EXAMPLE_REL = 'receipts/commit-message-conventions-claude-haiku-4-5-20251001-2026-07-27.json';
const EXAMPLE = JSON.parse(fs.readFileSync(path.join(ROOT, EXAMPLE_REL), 'utf8'));
const EXAMPLE_KEY = keyOf(path.join(ROOT, EXAMPLE_REL), ROOT);
const { verdictFromReceipt } = require('../lib/verdict.js');
// The draw-to-draw spread figure the front page has carried since Report #007,
// taken from the SAME derivation the repo gate checks it against rather than
// from a second one that could be right about a different number.
const prep007 = require('./prepare-report-007.js');
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const exampleVerdict = verdictFromReceipt(EXAMPLE);

const reportDirs = () => fs.readdirSync(path.join(DOCS, 'reports'), { withFileTypes: true })
  .filter((e) => e.isDirectory() && /^\d+$/.test(e.name))
  .map((e) => e.name).sort();

function receiptsFor(number) {
  return receiptFiles(ROOT).filter((f) => rel(f).startsWith(`receipts/report-${number}/`));
}

// The methodology page, wherever it currently lives. Spec 020 moves it from
// docs/methodology.html to docs/methodology/index.html, and a `from` that names
// a file the site no longer serves is a dead citation.
function methodologyPath() {
  for (const p of [path.join(DOCS, 'methodology', 'index.html'), path.join(DOCS, 'methodology.html')]) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('no methodology page found');
}

function buildStats() {
  const receipts = receiptFiles(ROOT);
  const models = new Set();
  let cases = 0;
  let refusals = 0;
  let withinNoise = 0;
  let judgeFrom = null;
  for (const f of receipts) {
    const r = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (r.run && r.run.model_id) models.add(modelId(r.run.model_id));
    else if (r.model) models.add(modelId(r.model));
    cases += new Set((((r.results || {}).cases) || []).map((c) => c.id)).size;
    const cell = cellOf(r);
    if (cell.state === 'refused') refusals++;
    if (cell.state === 'overlapping') withinNoise++;
    if (!judgeFrom && /claude-haiku-4-5/.test(fs.readFileSync(f, 'utf8'))) judgeFrom = rel(f);
  }

  const meth = methodologyPath();
  const rule = textOf(fs.readFileSync(meth, 'utf8'))
    .split(/(?<=[.])\s+/).find((s) => /Bands that touch or overlap/.test(s));
  if (!rule) throw new Error(`${rel(meth)}: the verdict rule sentence is no longer on the page`);

  const best007 = prep007.homepageFigure(prep007.readCells());
  const sources = JSON.parse(fs.readFileSync(path.join(DOCS, 'data', 'sources.json'), 'utf8'));
  const latest = reportDirs().slice(-1)[0];
  const latestPage = path.join(DOCS, 'reports', latest, 'index.html');
  const latestText = textOf(fs.readFileSync(latestPage, 'utf8'));
  const latestBig = (fs.readFileSync(latestPage, 'utf8')
    .match(/<div class="headline">[\s\S]*?<p class="big"[^>]*>([\s\S]*?)<\/p>/) || [])[1] || '';
  const latestReceipts = receiptsFor(latest);
  const dates = latestReceipts.map((f) => {
    const r = JSON.parse(fs.readFileSync(f, 'utf8'));
    return { d: ((r.run || {}).date_utc || '').slice(0, 10), f: rel(f) };
  }).filter((x) => x.d).sort((a, b) => a.d.localeCompare(b.d));

  return {
    _what: 'Derived at build by scripts/site-data.mjs. Every field carries the path it came from. Do not hand-edit: the spec gate regenerates this file and compares.',
    reports_published: F(reportDirs().length, 'docs/reports'),
    receipts_published: F(receipts.length, 'receipts'),
    substrates_measured: F(models.size, 'receipts'),
    cases_measured: F(cases, 'receipts'),
    refusals_published: F(refusals, 'receipts'),
    cells_within_noise: F(withinNoise, 'receipts'),
    judge_model: F('claude-haiku-4-5', judgeFrom),
    samples_per_draw: F(DEFAULT_JUDGE_SAMPLES, 'config.js'),
    effect_floor: F(EFFECT_FLOOR, 'config.js'),
    verdict_rule: F(prefix(rule, 200), rel(meth)),
    reports_published_word: F(WORDS[reportDirs().length], 'docs/reports'),
    version: F(JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version, 'package.json'),
    draw_spread_sd: F(best007.sd.toFixed(3), 'receipts/report-007'),
    draw_spread_case: F(best007.id, 'receipts/report-007'),
    draw_spread_arm: F(`${best007.slug}`, 'receipts/report-007'),
    first_report_number: F(reportDirs()[0], `docs/reports/${reportDirs()[0]}/index.html`),
    latest_report_number: F(latest, rel(latestPage)),
    latest_report_date: F(dates.length ? dates[dates.length - 1].d : '', dates.length ? dates[dates.length - 1].f : 'receipts'),
    latest_report_headline: F(prefix(firstSentence(textOf(latestBig)), 150), rel(latestPage)),
    // The bundled example receipt - the one behind
    // docs/badges/commit-message-conventions.json, and the one the hero card and
    // the playground both read. Its recorded comparison figures are used rather
    // than recomputed ones, so every number on the card is a string the receipt
    // file itself contains and the provenance check can find.
    example_receipt_skill: F(EXAMPLE.skill.name, EXAMPLE_REL),
    example_receipt_model: F(String(EXAMPLE.run.model_id).replace(/-\d{8}$/, ''), EXAMPLE_REL),
    example_receipt_date: F(EXAMPLE.run.date_utc.slice(0, 10), EXAMPLE_REL),
    example_receipt_verdict: F(exampleVerdict.verdict, 'lib/verdict.js'),
    example_receipt_baseline: F(EXAMPLE.comparison.baseline_score, EXAMPLE_REL),
    example_receipt_with_skill: F(EXAMPLE.comparison.with_skill_score, EXAMPLE_REL),
    example_receipt_delta: F(EXAMPLE.comparison.delta, EXAMPLE_REL),
    example_receipt_hash: F(EXAMPLE.receipt_hash.slice(0, 16), EXAMPLE_REL),
    example_receipt_plot: F(`plots/${EXAMPLE_KEY}.svg`, 'docs/plots'),
    skills_indexed: F(sources.skillsbench.skills, 'docs/data/sources.json'),
    skills_repos: F(sources.skillsbench.repos, 'docs/data/sources.json'),
    skillsbench_url: F(sources.skillsbench.url, 'docs/data/sources.json'),
    skillsbench_read_on: F(sources.skillsbench.read_on, 'docs/data/sources.json'),
    _latest_text_len: undefined,
    ...(latestText ? {} : {}),
  };
}

// ONE REPORT'S ROW, so that a page which is not in `reportDirs()` can still have
// one. Report 008 is authored and unapproved, so it lives at `008-draft/` and is
// deliberately invisible to `reportDirs()`, because the count of published
// reports must not move until the promote-rename. Its page still needs a TL;DR card, and the
// card must be built by THIS function rather than by a second one inside the
// report's own generator: two derivations of "what Report 008 says" would drift,
// and the card that ships at promotion would not be the card reviewed before it.
//
// So the generator calls this with its page in memory and gets the same row the
// data layer will derive from the file after promotion. Nothing about the draft
// is written to `docs/data/`, which is a published surface.
export function reportRow(n, opts = {}) {
  const essay = 'docs/writing/three-releases/index.html';
  const essayTitle = textOf((fs.readFileSync(path.join(ROOT, essay), 'utf8').match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || '');

  {
    const pageRel = opts.pageRel || `docs/reports/${n}/index.html`;
    const html = opts.html != null ? opts.html : fs.readFileSync(path.join(ROOT, pageRel), 'utf8');
    const h1 = textOf((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || '');
    const typeRaw = textOf((html.match(/<p class="report-type"[^>]*>([\s\S]*?)<\/p>/) || [])[1] || '');
    const bigHtml = (html.match(/<div class="headline">[\s\S]*?<p class="big"[^>]*>([\s\S]*?)<\/p>/) || [])[1] || '';
    const bigRaw = textOf(bigHtml);
    const verdict = verdictLine(bigHtml, html);
    const type = prefix(firstSentence(typeRaw), 60).replace(/\.$/, '');
    const moved = prefix(h1.replace(/^Report\s*#?\d+\s*(?:—|:)\s*/, ''), 90);

    const rfiles = receiptsFor(n);
    const models = [];
    let date = { d: '', f: 'receipts' };
    for (const f of rfiles) {
      const r = JSON.parse(fs.readFileSync(f, 'utf8'));
      const id = (r.run || {}).model_id || r.model;
      if (id) {
        const s = modelId(id);
        if (!models.some((m) => m.value === s)) models.push(F(s, rel(f)));
      }
      const d = ((r.run || {}).date_utc || '').slice(0, 10);
      if (d && d > date.d) date = { d, f: rel(f) };
    }
    models.sort((a, b) => a.value.localeCompare(b.value));

    // The receipt paths the PAGE itself links, so the list is what a reader can
    // reach from the report rather than what happens to sit in a directory.
    const linked = [...new Set([...html.matchAll(/href="[^"]*?(receipts\/[^"]+\.json)"/g)].map((m) => m[1]))].sort();

    return {
      number: F(n, pageRel),
      type: F(type, pageRel),
      title: F(h1, pageRel),
      what_moved: F(moved, pageRel),
      model_ids: models,
      date: F(date.d, date.f),
      // 200, not 120: report 005's headline sentence is 197 characters, and at
      // 120 it was the one field on the site that truncated. Rendering it whole
      // is the option F-020-B prefers over eliding, because AC-6's provenance
      // check finds a whole sentence in the page it cites and an elided one is
      // only findable by its prefix. The ellipsis above remains the guard for
      // anything that outgrows even this cap.
      headline_counts: F(prefix(firstSentence(bigRaw), 200), pageRel),
      // Absent, not empty, where the report has no verdict line of its own: a
      // {value: "", from: ...} pair would cite a file for a value it does not
      // carry, which is the one thing this data layer exists to refuse.
      ...(verdict ? { verdict_line: F(verdict, pageRel) } : {}),
      receipt_paths: linked.map((p) => F(p, pageRel)),
      plot: F(`plots/${rfiles.length ? keyOf(rfiles[0], ROOT) : 'none'}.svg`, 'docs/plots'),
      essay_links: [{ title: F(essayTitle, essay), href: F('/writing/three-releases/', 'docs/writing') }],
    };
  }
}

function buildReports() {
  const out = reportDirs().map((n) => reportRow(n));
  return { _what: 'Derived at build by scripts/site-data.mjs from the report pages and their receipts. Every field carries the path it came from.', reports: out.reverse() };
}

function main() {
  const i = process.argv.indexOf('--out');
  const outDir = i > -1 ? path.resolve(process.argv[i + 1]) : path.join(DOCS, 'data');
  fs.mkdirSync(outDir, { recursive: true });
  const stats = buildStats();
  delete stats._latest_text_len;
  fs.writeFileSync(path.join(outDir, 'stats.json'), `${JSON.stringify(stats, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, 'reports.json'), `${JSON.stringify(buildReports(), null, 2)}\n`);
  console.log(`site data written to ${path.relative(ROOT, outDir)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
export { buildStats, buildReports };
