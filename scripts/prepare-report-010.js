#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// prepare-report-010.js: render Driftproof Report 010, one upstream behavioural
// eval run five times under each of two Claude Code configurations (spec 041).
//
// THIS SCRIPT RENDERS, IT DOES NOT RUN. Nothing here calls a model or the network.
// The runs were made elsewhere: configuration A on this project's build box, and
// configuration B by a second party, delivered as `addy-adr-confirmation.zip`. The
// raw set is kept out of git under specs/000-governance/external-runs/ (it carries
// home-directory paths, upstream addresses and third-party SKILL.md text), and
// specs/041-report-010/evidence/raw-SHA256SUMS lists every file in it. What the
// report makes public is copied beside the page, byte-identical, by `--evidence`.
//
// NO DRIFTPROOF MEASUREMENT AND NO RECEIPTS. Every figure is read from the upstream
// harness's own output files; configuration A's run logs, matrices, run script,
// settings file and a Claude Code cache file; the upstream repository's skill and
// reference files; the second party's bundle; raw-SHA256SUMS; Report 009's published
// page and evidence; or this spec's GitHub check record (A-041-2). receipts/report-010/
// does not exist.
//
// EVERY FIGURE IS A <data> ELEMENT THAT NAMES ITS FILE, in Report 009's form: `value`
// as read, `data-src` the repository-relative file (several, space-separated, for a
// tally), `data-at` where in it, `data-fn` how it is read, `data-dp` the rounding
// shown. specs/041-report-010/probes/figures.mjs re-reads every one with its own
// reader, which shares no code with this file. A numeral in the body outside a
// <data> element is a gate failure.
//
// THE TEXT IS THE DRAFT'S. The prose below is ~/report-010-20260921/report-010-draft.md
// as reviewed, changed only where spec 041 § Changes to the draft lists; the gate
// compares the page's text with the draft through exactly that list.
//
// Usage:
//   node scripts/prepare-report-010.js              # render docs/reports/010/
//   node scripts/prepare-report-010.js --check      # re-render, exit 1 on drift
//   node scripts/prepare-report-010.js --page       # print to stdout, write nothing
//   node scripts/prepare-report-010.js --evidence   # copy the published evidence from the raw set

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { applyHeadTags } = require('./build-head-tags');
const { renderReportPage, bibtex } = require('./site-chrome');
const { reportRow } = require('./site-data.mjs');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'docs', 'reports', '010');
const PAGE_REL = 'reports/010/index.html';
const NUMBER = /reports\/(\d+)/.exec(PAGE_REL)[1];

const PUB = 'docs/reports/010/evidence';
const RAW = 'specs/000-governance/external-runs';
const A = 'report-010-20260921';
const B = 'addy-adr-confirmation';
const CHECK = 'github-check-20260921T172411Z.json';
// Amendment 1 (spec 041 A-041-4): issue 591 read again after publication, for the maintainer's answer.
const CHECK2 = 'github-check-20260923T040657Z.json';
// A-041-5: the outcome so far, PR 598 and the reply on issue 591, read once more.
const CHECK3 = 'github-check-20260923T045104Z.json';
const SPEC_EV = 'specs/041-report-010/evidence';

// The published evidence: [bundle, path inside it]. A file is published only when it
// passes the repository's blocking scans unchanged and carries no third-party skill
// text or raw model output; everything else is listed by sha256 in raw-SHA256SUMS.
const RUNS = [1, 2, 3, 4, 5];
const PUBLISHED = [
  [A, 'log.txt'], [A, 'matrix.md'],
  ...RUNS.flatMap((n) => [[A, `run-${n}/exit-code.txt`], [A, `run-${n}/results/documentation-and-adrs.eval-1.grading.json`]]),
  [A, 'fix-runs/log.txt'], [A, 'fix-runs/matrix.md'],
  ...RUNS.map((n) => [A, `fix-runs/run-${n}/exit-code.txt`]),
  ...[1, 2, 3, 5].map((n) => [A, `fix-runs/run-${n}/results/documentation-and-adrs.eval-1.grading.json`]),
  [A, 'fix-runs/run-4/results/documentation-and-adrs.eval-1.grading.raw.txt'],
  [B, 'environment.json'], [B, 'verified-results.json'], [B, 'report.md'],
  ...RUNS.flatMap((n) => [[B, `run-${n}/documentation-and-adrs.eval-1.grading.json`], [B, `run-${n}/runner-status.json`]]),
  ...[2, 3, 4, 5].map((n) => [B, `fixed-trace-grade-${n}/grading.json`]),
];
// Two files of this spec's own evidence are also published beside the page, as twins.
const TWINS = ['raw-SHA256SUMS', CHECK, CHECK2, CHECK3];

const pubName = (bundle, rel) => `${PUB}/${bundle}--${rel.split('/').join('--')}`;
const pa = (rel) => pubName(A, rel);
const pb = (rel) => pubName(B, rel);
const rawA = (rel) => `${RAW}/${A}/${rel}`;
const SUMS = `${PUB}/raw-SHA256SUMS`;
const GH = `${PUB}/${CHECK}`;
const GH2 = `${PUB}/${CHECK2}`;
const GH3 = `${PUB}/${CHECK3}`;
const R9 = 'docs/reports/009/evidence';
const R9REC = `${R9}/three-skill-comparison--driftproof--documentation-and-adrs--receipts--documentation-and-adrs-claude-opus-5-2026-09-15.json`;
const R9NAT = `${R9}/three-skill-comparison--native--documentation-and-adrs--results--aggregate-result.json`;
const R9SUMS = `${R9}/three-skill-comparison--SHA256SUMS`;
const R9PROT = `${R9}/three-skill-comparison--protocol.md`;
const R9PAGE = 'docs/reports/009/index.html';
const GRADING = 'documentation-and-adrs.eval-1.grading.json';
const SKILL_REL = 'skills/documentation-and-adrs/SKILL.md';
const VCACHE = 'fix-runs/run-2/tmp/claude-1000/cache-break-state-297d8716-050b-44d7-92e6-c369de44dd7e.json';
// Configuration A's user settings file as it stood before the run script set the model (loop 2,
// QA outside-brief note 2): what it sets and what it does not configure are read from its keys.
const SETTINGS = 'settings.json.before';
const SETTINGS_ABSENT = ['hooks', 'mcpServers', 'autoMemoryEnabled'];

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const readText = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const readJson = (rel) => JSON.parse(readText(rel));
const sha = (rel) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, rel))).digest('hex');
const sumsLine = (rel) => {
  const line = readText(SUMS).split('\n').find((l) => l.endsWith(`  ${rel}`));
  if (!line) throw new Error(`raw-SHA256SUMS lists no ${rel}`);
  return line.slice(0, 64);
};

// Where a file is shown to a reader: a published copy by its path; a raw file by its
// path in the raw set, marked as not published.
function shown(rel) {
  if (rel.startsWith(`${RAW}/`)) {
    return `<code>${esc(rel.slice(RAW.length + 1))}</code> <span class="muted">(in the raw set, not published; its sha256 is in <code>raw-SHA256SUMS</code>)</span>`;
  }
  return `<code>${esc(rel)}</code>`;
}

function D(display, value, src, at, fn = 'v', dp = null) {
  return `<data value="${esc(value)}" data-src="${esc([].concat(src).join(' '))}" data-at="${esc(at)}" data-fn="${esc(fn)}"${dp == null ? '' : ` data-dp="${dp}"`}>${esc(display)}</data>`;
}
const n2 = (v) => Number(v).toFixed(2);
const n3 = (v) => Number(v).toFixed(3);
const WORD = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const cap = (s) => s[0].toUpperCase() + s.slice(1);

function cite(html) {
  const files = [...new Set([...html.matchAll(/data-src="([^"]+)"/g)].flatMap((m) => m[1].split(' ')))];
  return `<p class="muted cite">Read from: ${files.map(shown).join('; ')}.</p>`;
}

// ---- reading the evidence -----------------------------------------------------

function readAll() {
  const a = RUNS.map((n) => {
    const g = readJson(pa(`run-${n}/results/${GRADING}`));
    return { n, g, exit: readText(pa(`run-${n}/exit-code.txt`)).trim(), src: pa(`run-${n}/results/${GRADING}`), exitSrc: pa(`run-${n}/exit-code.txt`) };
  });
  const v = readJson(pb('verified-results.json'));
  const env = readJson(pb('environment.json'));
  const b = RUNS.map((n) => ({ n, g: readJson(pb(`run-${n}/${GRADING}`)), st: readJson(pb(`run-${n}/runner-status.json`)), src: pb(`run-${n}/${GRADING}`), stSrc: pb(`run-${n}/runner-status.json`) }));
  const fx = RUNS.map((n) => {
    const rel = `fix-runs/run-${n}/results/${GRADING}`;
    const has = fs.existsSync(path.join(ROOT, pa(rel)));
    return { n, g: has ? readJson(pa(rel)) : null, exit: readText(pa(`fix-runs/run-${n}/exit-code.txt`)).trim(), src: pa(rel), rawSrc: pa(`fix-runs/run-${n}/results/documentation-and-adrs.eval-1.grading.raw.txt`), exitSrc: pa(`fix-runs/run-${n}/exit-code.txt`) };
  });
  const gh = readJson(GH);
  const gh2 = readJson(GH2);
  const gh3 = readJson(GH3);
  return { a, b, v, env, fx, gh, gh2, gh3, log: readText(pa('log.txt')), fixLog: readText(pa('fix-runs/log.txt')), matrix: readText(pa('matrix.md')), fixMatrix: readText(pa('fix-runs/matrix.md')) };
}

// The tallies. Each names every file it is summed over and the rule, which the
// figures probe re-derives by its own reading of the same files.
function tallies(E) {
  const aSrc = E.a.map((x) => x.exitSrc);
  const bSrc = pb('verified-results.json');
  const aPass = E.a.filter((x) => x.exit === '0').length;
  const bPass = E.v.fresh_runs.filter((r) => r.exit_code === 0).length;
  const exp = (i) => E.a.filter((x) => x.g.expectations[i].passed === true).length + E.v.fresh_runs.filter((r) => r.expectations[i].passed === true).length;
  return {
    total: { v: E.a.length + E.v.fresh_runs.length, src: [...aSrc, bSrc], at: 'runs', fn: 'tally' },
    perA: { v: E.a.length, src: aSrc, at: 'runs', fn: 'tally' },
    perB: { v: E.v.fresh_runs.length, src: [bSrc], at: 'fresh_runs', fn: 'tally' },
    // Each configuration's own files: A's five exit codes and B's fresh runs, equal (loop 2).
    perEach: { v: E.a.length === E.v.fresh_runs.length ? E.a.length : NaN, src: [...aSrc, bSrc], at: 'runs per configuration', fn: 'tally' },
    passed: { v: aPass + bPass, src: [...aSrc, bSrc], at: 'exit=0', fn: 'tally' },
    failed: { v: E.a.length + E.v.fresh_runs.length - aPass - bPass, src: [...aSrc, bSrc], at: 'exit!=0', fn: 'tally' },
    aPass: { v: aPass, src: aSrc, at: 'exit=0', fn: 'tally' },
    aFail: { v: E.a.length - aPass, src: aSrc, at: 'exit!=0', fn: 'tally' },
    bPass: { v: bPass, src: [bSrc], at: 'fresh_runs[*].exit_code=0', fn: 'tally' },
    exp1: { v: exp(0), src: [...E.a.map((x) => x.src), bSrc], at: 'expectations[0].passed', fn: 'tally' },
    exp2: { v: exp(1), src: [...E.a.map((x) => x.src), bSrc], at: 'expectations[1].passed', fn: 'tally' },
    exp3: { v: exp(2), src: [...E.a.map((x) => x.src), bSrc], at: 'expectations[2].passed', fn: 'tally' },
    // Amendment 1 (QA O-4): how many expectations any of the ten runs failed.
    expFailed: { v: [0, 1, 2].filter((k) => E.a.some((x) => x.g.expectations[k].passed === false) || E.v.fresh_runs.some((r) => r.expectations[k].passed === false)).length, src: [...E.a.map((x) => x.src), bSrc], at: 'expectations with a failure', fn: 'tally' },
    model: { v: [...new Set([...E.a.map((x) => x.g.run.executor_model), ...E.b.map((x) => x.g.run.executor_model)])].join(','), src: [...E.a.map((x) => x.src), ...E.b.map((x) => x.src)], at: 'run.executor_model', fn: 'tally' },
    fixGraded: { v: E.fx.filter((x) => x.g).length, src: E.fx.map((x) => (x.g ? x.src : x.rawSrc)), at: 'grading.json present', fn: 'tally' },
    fixAllPass: { v: E.fx.filter((x) => x.g && x.g.expectations.every((e) => e.passed === true)).length, src: E.fx.filter((x) => x.g).map((x) => x.src), at: 'expectations[*].passed all true', fn: 'tally' },
  };
}
const T = (t, display = String(t.v)) => D(display, t.v, t.src, t.at, t.fn);
// The two fields a receipt-less report's row reads off its page (site-data.mjs, spec 041).
const ROW = (field, html) => html.replace(/^<data /, `<data data-row="${field}" `);
const TW = (t, capital = false) => T(t, capital ? cap(WORD[t.v]) : WORD[t.v]);

// ---- the page's blocks -----------------------------------------------------------

function headlineBlock(E, t) {
  const body = `    <p class="big">One skill&rsquo;s behavioural eval from its own repository, run ${TW(t.total)} times with the same skill text, the same eval case and the same executor model, ${TW(t.perEach)} times under each of two Claude Code configurations. ${TW(t.passed, true)} runs passed and ${TW(t.failed)} failed. Both failures fell on ${TW(t.expFailed)} expectation, and that expectation is a rule absent from the skill&rsquo;s ADR instructions in <code>SKILL.md</code>.</p>`;
  return `${body}
    ${cite(body)}`;
}

// What configuration A's settings file sets, and what it does not configure, each read from its
// top-level keys (loop 2).
function settingsKeys() { return Object.keys(readJson(rawA(SETTINGS))); }
function settingsSets() {
  const k = settingsKeys();
  const want = ['model', 'tui', 'theme', 'skipDangerousModePermissionPrompt', 'skipWorkflowUsageWarning', 'autoMode'];
  if (k.length !== want.length || !want.every((x) => k.includes(x))) throw new Error(`the settings file's keys are no longer the six this sentence names: ${k.join(', ')}`);
  return D('sets the model, the terminal UI, the theme, two prompt suppressions and an auto-mode policy', k.join(','), rawA(SETTINGS), '', 'json-keys');
}
function settingsAbsent() {
  const k = settingsKeys();
  if (SETTINGS_ABSENT.some((x) => k.includes(x))) throw new Error('the settings file now configures one of hooks, MCP servers or auto-memory');
  return D('configures no hooks, no MCP servers and no auto-memory setting', SETTINGS_ABSENT.join(','), rawA(SETTINGS), '', 'json-keys-absent');
}

function limitsSection(E, t) {
  const V9 = readJson(R9REC);
  const verA = readJson(rawA(VCACHE)).sdk.buildVersion;
  const verB = /^(\S+)/.exec(E.env.claude_version)[1];
  const issue = E.gh.issue;
  const html = `  <h2 id="limits">Limits, read these first</h2>
  <div class="card">
    <p>${TW(t.total, true)} runs in total, ${TW(t.perEach)} per configuration. One eval case, one executor model, one skill. This is not a pass rate estimate for the skill, the harness or the model.</p>
    <p>The two configurations differ in Claude Code version (${D(verA, verA, rawA(VCACHE), 'sdk.buildVersion')}, recorded during the exploratory runs on the same box, against ${D(verB, verB, pb('environment.json'), 'claude_version', 're:^(\\S+)')}), in settings (a user settings file that ${settingsSets()}, and ${settingsAbsent()}, against hooks, MCP and auto-memory off with the model pinned on both generator and grader), and in random draw. These experiments do not isolate what caused the variation between them.</p>
    <p>Grader repeatability was tested on one passing transcript only: ${D(WORD[E.v.fixed_trace_grades.length], E.v.fixed_trace_grades.length, pb('verified-results.json'), 'fixed_trace_grades', 'count')} gradings of one transcript from configuration B agreed on every expectation. The ${TW(t.aFail)} failing transcripts from configuration A were not kept, because the harness does not save executor traces, so the grader&rsquo;s reading of them cannot be replayed. Their failure reasons are the grader&rsquo;s own evidence text.</p>
    <p>An eval may legitimately check quality a skill never spells out. That the rule is absent from <code>SKILL.md</code> is a question for the maintainer, filed as <a href="${esc(issue.url)}">issue #${D(issue.number, issue.number, GH, 'issue.number')}</a>, not a defect.</p>
    <p>Configuration A&rsquo;s raw evidence was produced on the Driftproof build box and is published below, each file in full or, where it carries a local path or third-party skill text, by its sha256; it was not independently verified by the second party.</p>
    <p>No Driftproof measurement was taken for this report. No Driftproof judge ran, and there are no Driftproof receipts and so no verification level: every figure on this page is read from the upstream harness&rsquo;s own output files; configuration A&rsquo;s run logs, run matrices, run script and user settings file; a Claude Code cache file written during the exploratory runs; the skill and reference files in the upstream repository; the second party&rsquo;s bundle; the raw set&rsquo;s checksum list, <code>raw-SHA256SUMS</code>; Report 009&rsquo;s published page and evidence; or this report&rsquo;s GitHub check record. Report 009 appears as background only. Its figures were judged by ${D(V9.run.judge.model_id, V9.run.judge.model_id, R9REC, 'run.judge.model_id')} under that report&rsquo;s declared departure from judge policy and carry Report 009&rsquo;s limits.</p>
  </div>`;
  return `${html.replace(/\n  <\/div>$/, '')}
    ${cite(html)}
  </div>`;
}

function backgroundSection() {
  const V9 = readJson(R9REC);
  const N9 = readJson(R9NAT);
  const c = N9.cases[0];
  const w = V9.results.cases.find((x) => x.mode === 'with_skill').generation;
  const b = V9.results.cases.find((x) => x.mode === 'baseline').generation;
  const fired = c.arms.with.filter((x) => x.graders.find((g) => g.name === 'skill-fired').passed === true).length;
  const commit9 = /commit ([0-9a-f]{40})/.exec(readText(R9PROT))[1].slice(0, 7);
  const quote = 'These files do not show what produced the difference';
  const body = `  <h2 id="background">Background: what Report 009 measured for this skill</h2>
  <div class="card">
    <p><a href="../009/">Report 009</a> measured <code>documentation-and-adrs</code> (with the same <code>SKILL.md</code> bytes as here, at commit <code>${D(commit9, commit9, R9PROT, 'commit ([0-9a-f]{40})', 're-prefix7')}</code>) on a different task: improving the comments in a JavaScript file. It used a minimal single-skill plugin under Claude Code&rsquo;s native plugin eval, and the skill text in the prompt under Driftproof. The native eval read ${D(n3(c.aggregates.score), c.aggregates.score, R9NAT, 'cases[0].aggregates.score', 'v', 3)} with the skill against ${D(n3(c.aggregates.scoreWithout), c.aggregates.scoreWithout, R9NAT, 'cases[0].aggregates.scoreWithout', 'v', 3)} without, with the skill&rsquo;s tool ${D('never called', fired, R9NAT, 'cases[0].arms.with[*].graders[name=skill-fired].passed', 'count-true-zero')}; Driftproof read ${D(n3(w.mean), w.mean, R9REC, 'results.cases[mode=with_skill].generation.mean', 'v', 3)} against ${D(n3(b.mean), b.mean, R9REC, 'results.cases[mode=baseline].generation.mean', 'v', 3)}. Report 009&rsquo;s own reading is narrower: its traces show the Skill tool was not called in any with-plugin run, and ${D('its files do not show what produced the difference', quote, R9PAGE, quote, 'contains')}.</p>
    <p>Those figures measure different things from the ones below (native pass fractions, Driftproof judge ratings, and here fractions of expectations passed), on a different task. They are not a third arm of this experiment.</p>
  </div>`;
  return `${body.replace(/\n  <\/div>$/, '')}
    ${cite(body)}
  </div>`;
}

function instrumentSection(E, t) {
  const nExp = E.a[0].g.expectations.length;
  const commitA = /agent-skills commit: ([0-9a-f]{40})/.exec(E.matrix)[1];
  const body = `  <h2 id="instrument">The instrument</h2>
  <div class="card">
    <p>The skill, fixture and harness are published in the <code>addyosmani/agent-skills</code> repository. The harness, <code>scripts/run-evals.js --behavioral</code>, runs one headless Claude Code session for this skill against a fixture (<code>evals/fixtures/documentation-and-adrs/decision-context.md</code>), asks for an ADR, and has a model grade the transcript against ${D(WORD[nExp], nExp, E.a[0].src, 'expectations', 'count')} written expectations. It prints a pass rate and exits ${D('0', '0', E.a[1].exitSrc, '', 'text')} or ${D('1', '1', E.a[0].exitSrc, '', 'text')}. It has no built-in repetition, no spread estimate and no explicit inconclusive or underpowered verdict. Each invocation uses one executor draw and returns a binary process outcome unless execution or parsing fails.</p>
    <p>The skill was at commit <code>${D(commitA.slice(0, 7), commitA, pa('matrix.md'), 'agent-skills commit: ([0-9a-f]{40})', 're-prefix7')}</code> for all ${TW(t.total)} runs. The executor model was ${ROW('model', T(t.model))} in every run.</p>
  </div>`;
  return `${body.replace(/\n  <\/div>$/, '')}
    ${cite(body)}
  </div>`;
}

function provenanceSection(E) {
  const [p576, p578, p587] = [576, 578, 587].map((n) => E.gh.pulls.find((p) => p.number === n));
  const i = (p) => E.gh.pulls.indexOf(p);
  const pr = (p) => `<a href="${esc(p.url)}">PR #${D(p.number, p.number, GH, `pulls[${i(p)}].number`)}</a>`;
  const hash = (p) => `<a href="${esc(p.url)}">#${D(p.number, p.number, GH, `pulls[${i(p)}].number`)}</a>`;
  // The account that ran configuration A is the one that filed issue 591 describing those runs
  // (loop 2, QA fix 3); the PRs' author is the same account, which the probe checks.
  const who = D(E.gh.issue.author, E.gh.issue.author, GH, 'issue.author');
  const rel = E.gh.release;
  const issue = E.gh.issue;
  const body = `  <h2 id="provenance">Provenance and disclosure</h2>
  <div class="card">
    <p>Configuration A was run by <code>${who}</code>, who had previously contributed ${harnessPrs(E)} merged changes to the repository&rsquo;s behavioural-evaluation harness. ${pr(p576)} binds grader results to declared expectations, replaces grader-paraphrased expectation text with the canonical wording and derives <code>pass_rate</code> from the validated results. ${pr(p587)} clears the result slot before each run and records the executor model and timestamp. Both changes are present in the harness used here and affect how this report&rsquo;s evidence is validated or recorded.</p>
    <p>The <code>executor_model</code> field shown in this report comes from ${hash(p587)}. Its result-slot clearing also prevents a rejected or interrupted run from leaving an earlier successful grading file in place. The malformed grader response in the exploratory experiment was rejected by the parser; ${hash(p587)} establishes that no stale successful result survived beside it.</p>
    <p>The same account also contributed ${pr(p578)}, which fixed an unrelated <code>simplify-ignore</code> hook and has no bearing on this experiment. <a href="${esc(rel.url)}">Release ${D(rel.tag, rel.tag, GH, 'release.tag')}</a> credited <code>${who}</code> for ${hash(p576)} and ${hash(p578)}; ${hash(p587)} merged later. <a href="${esc(issue.url)}">Issue #${D(issue.number, issue.number, GH, 'issue.number')}</a>, asking whether the timeless-language rule is meant to apply to ADRs, was filed by the same account and was open and unanswered when checked at <code>${D(E.gh.checked_at, E.gh.checked_at, GH, 'checked_at')}</code>.</p>
  </div>`;
  return `${body.replace(/\n  <\/div>$/, '')}
    ${cite(body)}
  </div>`;
}

const pf = (x) => (x ? 'pass' : 'fail');

function resultsSection(E, t) {
  const verA = readJson(rawA(VCACHE)).sdk.buildVersion;
  const verB = /^(\S+)/.exec(E.env.claude_version)[1];
  const rowsA = E.a.map((x) => `      <tr><td>${D(x.n, x.n, x.src, 'run', 'run-index')}</td>${[0, 1, 2].map((k) => `<td>${D(pf(x.g.expectations[k].passed), x.g.expectations[k].passed, x.src, `expectations[${k}].passed`, 'passfail')}</td>`).join('')}<td>${D(n2(x.g.summary.pass_rate), x.g.summary.pass_rate, x.src, 'summary.pass_rate', 'v', 2)}</td><td>${D(x.exit, x.exit, x.exitSrc, '', 'text')}</td></tr>`).join('\n');
  const V = pb('verified-results.json');
  const allB = (at, fnVal) => E.v.fresh_runs.map(fnVal);
  const same = (vals) => vals.every((x) => x === vals[0]);
  const bExp = [0, 1, 2].map((k) => {
    const vals = allB(`fresh_runs[*].expectations[${k}].passed`, (r) => r.expectations[k].passed);
    if (!same(vals)) throw new Error('configuration B no longer reads one row');
    return `<td>${D(pf(vals[0]), vals[0], V, `fresh_runs[*].expectations[${k}].passed`, 'all-equal-passfail')}</td>`;
  }).join('');
  const bRate = allB('', (r) => r.summary.pass_rate); const bExit = allB('', (r) => r.exit_code);
  if (!same(bRate) || !same(bExit)) throw new Error('configuration B no longer reads one row');
  const rowB = `      <tr><td>${D(E.v.fresh_runs[0].run, E.v.fresh_runs[0].run, V, 'fresh_runs[0].run')} to ${D(E.v.fresh_runs[E.v.fresh_runs.length - 1].run, E.v.fresh_runs[E.v.fresh_runs.length - 1].run, V, `fresh_runs[${E.v.fresh_runs.length - 1}].run`)}</td>${bExp}<td>${D(n2(bRate[0]), bRate[0], V, 'fresh_runs[*].summary.pass_rate', 'all-equal', 2)}</td><td>${D(bExit[0], bExit[0], V, 'fresh_runs[*].exit_code', 'all-equal')}</td></tr>`;
  const head = '<thead><tr><th>Run</th><th>Expectation 1</th><th>Expectation 2</th><th>Expectation 3</th><th>pass_rate</th><th>Exit</th></tr></thead>';
  const nFx = E.v.fixed_trace_grades.length;
  const exps = E.a[0].g.expectations;
  const id = (k) => D(exps[k].id, exps[k].id, E.a[0].src, `expectations[${k}].id`);
  const aText = `  <p>Configuration A: Driftproof build box, Claude Code ${D(verA, verA, rawA(VCACHE), 'sdk.buildVersion')} (recorded during the exploratory runs on the same box), the user settings file described under Limits, with the model selected through <code>settings.json</code>.</p>`;
  const tableA = `  <table class="summary">
    ${head}
    <tbody>
${rowsA}
    </tbody>
  </table>`;
  const bText = `  <p>Configuration B: a separate rerun performed by a second party on a second machine, Claude Code ${D(verB, verB, pb('environment.json'), 'claude_version', 're:^(\\S+)')}, <code>--model ${D(E.env.model, E.env.model, pb('environment.json'), 'model')}</code> on generator and grader, hooks, MCP and auto-memory off, grader tools off.</p>`;
  const tableB = `  <table class="summary">
    ${head}
    <tbody>
${rowB}
    </tbody>
  </table>`;
  const replay = `  <p>Configuration B also replayed one grader input byte for byte ${D(WORD[nFx - 1], nFx - 1, V, 'fixed_trace_grades', 'count-minus-1')} more times; all ${D(WORD[nFx], nFx, V, 'fixed_trace_grades', 'count')} gradings agreed on every expectation.</p>`;
  const expl = `  <p>The expectations: (${id(0)}) the ADR states context, decision, alternatives and consequences distinctly; (${id(1)}) trade-offs and rejected options are recorded, not just the winning choice; (${id(2)}) the document is written in timeless language describing current state. Across the ${TW(t.total)} runs, ${id(0)} and ${id(1)} passed ${T(t.exp1)} of ${T(t.total)} and ${id(2)} passed ${T(t.exp3)} of ${T(t.total)}. With ${D(WORD[exps.length], exps.length, E.a[0].src, 'expectations', 'count')} expectations in the case, one failed expectation makes the entire run fail.</p>
  <p>The aggregate ${T(t.passed)}-of-${T(t.total)} figure is a descriptive tally only. It is not a pooled pass-rate estimate, and the ${T(t.aPass)}-of-${T(t.perA)} versus ${T(t.bPass)}-of-${T(t.perB)} outcomes do not establish that configuration B is better than configuration A.</p>`;
  if (t.exp1.v !== t.exp2.v) throw new Error('expectations 1 and 2 no longer pass alike');
  return `  <h2 id="results">Results</h2>
${aText}
${tableA}
  ${cite(aText + rowsA)}
${bText}
${tableB}
${replay}
  ${cite(bText + rowB + replay)}
${expl}
  ${cite(expl)}`;
}

function readingsSection(E, t) {
  const skill = rawA(`run-1/tree/${SKILL_REL}`);
  const dod = rawA('run-1/tree/references/definition-of-done.md');
  const r1 = `  <p class="claim" data-claim="1"><strong>The single draw is the verdict.</strong> Under configuration A the same command at the same commit returned exit ${D('0', '0', E.a.map((x) => x.exitSrc), 'exit=0', 'tally-value')} ${D(WORD[t.aPass.v], t.aPass.v, t.aPass.src, t.aPass.at, 'tally')} times and exit ${D('1', '1', E.a.map((x) => x.exitSrc), 'exit!=0', 'tally-value')} ${D(t.aFail.v === 2 ? 'twice' : WORD[t.aFail.v], t.aFail.v, t.aFail.src, t.aFail.at, 'tally')}. A CI job that ran once would have reported whichever it happened to get, and nothing in the printed number marks it as one draw of several.</p>`;
  const failing = E.a.filter((x) => x.exit !== '0');
  const r2 = `  <p class="claim" data-claim="2"><strong>The expectation that moved is absent from the skill&rsquo;s ADR instructions.</strong> <code>SKILL.md</code> ${D('does not ask for timeless language', 'timeless', skill, 'timeless', 'absent-ci')}. The wording comes from the repository&rsquo;s <code>references/definition-of-done.md</code>, ${D('which is about documentation in general', 'timeless language', dod, 'timeless language', 'contains')}, and the skill describes an ADR as a dated record with a ${D('status lifecycle', '## Status', skill, '## Status', 'contains')}. The grader&rsquo;s evidence on the ${D(WORD[failing.length], failing.length, E.a.map((x) => x.exitSrc), 'exit!=0', 'tally')} failing runs cited wording such as &ldquo;${D('currently', 'currently stores', failing[1].src, 'expectations[2].evidence|currently stores', 'contains-at')}&rdquo; and &ldquo;${D('before cutover', 'Before cutover', failing[0].src, 'expectations[2].evidence|Before cutover', 'contains-at')}&rdquo;. Whether the rule should apply to ADRs is the maintainer&rsquo;s call, and <a href="${esc(E.gh.issue.url)}">#${D(E.gh.issue.number, E.gh.issue.number, GH, 'issue.number')}</a> asks it.</p>`;
  const r3 = '  <p class="claim" data-claim="3"><strong>Configuration is part of the record.</strong> The observed runs included both passing and failing verdicts; these experiments do not isolate what caused that variation. Version, settings and random draw all differ between the two sets. A single run under either configuration does not establish what a repeat will return. What the record supports is narrower: under configuration A one command at one commit returned both verdicts, so a single run&rsquo;s verdict is one draw under one configuration.</p>';
  const all = [r1, r2, r3].join('\n');
  return `  <h2 id="three-readings">Three readings</h2>
${all}
  ${cite(all)}`;
}

function exploratorySection(E, t) {
  const graded = E.fx.filter((x) => x.g);
  const failed = E.fx.filter((x) => !x.g);
  if (failed.length !== 1) throw new Error('the exploratory set no longer has exactly one ungraded run');
  const f = failed[0];
  const rawRel = pa(`fix-runs/run-${f.n}/results/documentation-and-adrs.eval-1.grading.raw.txt`);
  const nExp = graded[0].g.expectations.length;
  const idx = graded.map((x) => D(x.n, x.n, x.src, 'run', 'run-index'));
  const list = `${idx.slice(0, -1).join(', ')} and ${idx[idx.length - 1]}`;
  const body = `  <h2 id="exploratory">A separate exploratory experiment: replacing the expectation</h2>
  <div class="card">
    <p>Separately from the ${TW(t.total)} runs above, a branch was prepared (not proposed, because deleting a quality check needs the maintainer&rsquo;s reading of the rule first) that replaces expectation ${D(E.a[0].g.expectations[2].id, E.a[0].g.expectations[2].id, E.a[0].src, 'expectations[2].id')} with a rule the skill does state: the ADR records a status and a date. ${D(cap(WORD[E.fx.length]), E.fx.length, E.fx.map((x) => x.exitSrc), 'runs', 'tally')} runs under configuration A with that replacement: ${T(t.fixGraded, WORD[t.fixGraded.v])} graded (runs ${list}), all ${D(WORD[nExp], nExp, graded[0].src, 'expectations', 'count')} expectations ${T(t.fixAllPass, 'passed in each')}. Run ${D(f.n, f.n, f.exitSrc, 'run', 'run-index')} failed because the grader returned invalid JSON (${D('one opening brace missing', '},"id":2', rawRel, '},"id":2', 'contains')}); the harness&rsquo;s parser rejected it, retained the raw response and exited ${D(f.exit, f.exit, f.exitSrc, '', 'text')}. These ${TW({ v: E.fx.length, src: E.fx.map((x) => x.exitSrc), at: 'runs', fn: 'tally' })} runs are exploratory, on a modified case, and are not part of the ${TW(t.total)}-run result.</p>
  </div>`;
  return `${body.replace(/\n  <\/div>$/, '')}
    ${cite(body)}
  </div>`;
}

function runRecordSection(E) {
  const logLine = (text, re) => (re.exec(text) || [])[1];
  const LOG = pa('log.txt');
  const runsA = E.a.map((x) => {
    const s = logLine(E.log, new RegExp(`^run ${x.n} start (\\S+)$`, 'm'));
    const e = logLine(E.log, new RegExp(`^run ${x.n} end (\\S+) exit`, 'm'));
    const start = D(s, s, LOG, `^run ${x.n} start (\\S+)$`, 're');
    return `run ${D(x.n, x.n, x.src, 'run', 'run-index')} <code>${x.n === 1 ? ROW('date', start) : start}</code> to <code>${D(e, e, LOG, `^run ${x.n} end (\\S+) exit`, 're')}</code>, graded at <code>${D(x.g.run.timestamp, x.g.run.timestamp, x.src, 'run.timestamp')}</code>`;
  }).join('; ');
  const restored = logLine(E.log, /^settings restored (\S+)$/m);
  const verA = readJson(rawA(VCACHE)).sdk.buildVersion;
  const zip = `${A}/addy-adr-confirmation.zip`;
  const zipSha = sumsLine(zip);
  const ENV = pb('environment.json');
  const V = pb('verified-results.json');
  const commit = E.env.commit;
  const commit9 = /commit ([0-9a-f]{40})/.exec(readText(R9PROT))[1];
  const s9 = readText(R9SUMS).split('\n').find((l) => l.endsWith('  inputs/native/documentation-and-adrs/skills/documentation-and-adrs/SKILL.md')).slice(0, 64);
  const sB = E.env.source_sha256[SKILL_REL];
  const sA = sumsLine(`${A}/run-1/tree/${SKILL_REL}`);
  if (!(s9 === sB && sB === sA)) throw new Error('the SKILL.md bytes are no longer the same at both commits');
  const runsB = E.b.map((x) => `run ${D(x.n, x.n, x.src, 'run', 'run-index')} <code>${D(x.g.run.timestamp, x.g.run.timestamp, x.src, 'run.timestamp')}</code>`).join(', ');
  const exA = E.a.map((x) => D(x.g.run.executor_model, x.g.run.executor_model, x.src, 'run.executor_model')).join(', ');
  const exB = E.b.map((x) => D(x.g.run.executor_model, x.g.run.executor_model, x.src, 'run.executor_model')).join(', ');
  const grA = [...new Set(E.a.map((x) => x.g.run.grader_model))];
  if (grA.length !== 1) throw new Error('configuration A no longer records one grader model');
  const initModels = [...new Set(E.v.calls.map((c) => c.init_model))];
  if (initModels.length !== 1) throw new Error('configuration B no longer records one model');
  const fxS = logLine(E.fixLog, /^run 1 start (\S+)$/m);
  const fxE = logLine(E.fixLog, /^settings restored (\S+)$/m);
  const fxCommit = /COMMIT=([0-9a-f]{40})/.exec(readText(rawA('fix-runs/run-all.sh')))[1];
  const inner = `    <p><strong>Configuration A</strong> ran by the run script&rsquo;s log: ${runsA}. The model setting was restored at <code>${D(restored, restored, LOG, '^settings restored (\\S+)$', 're')}</code>, and the settings file&rsquo;s sha256 after the runs equals its sha256 before (<code>${D(sumsLine(`${A}/settings.json.before`).slice(0, 16), sumsLine(`${A}/settings.json.before`), SUMS, `${A}/settings.json.before`, 'sha-line-prefix')}</code>; the ${settingsShaFiles()} sha256 files carry a local path and are not published). The harness and the run script do not record the Claude Code version: ${D(verA, verA, rawA(VCACHE), 'sdk.buildVersion')} is the <code>sdk.buildVersion</code> a session cache file recorded during the exploratory runs on the same box. The executor model as recorded per run: ${exA}. The grader model is recorded as <code>${D(grA[0], grA[0], E.a.map((x) => x.src), 'run.grader_model', 'all-equal')}</code> in every grading file, because the harness does not record it.</p>
    <p><strong>Configuration B</strong> is the bundle <code>addy-adr-confirmation.zip</code>, sha256 <code>${D(zipSha, zipSha, SUMS, zip, 'sha-line')}</code>. Its <code>environment.json</code> records commit <code>${D(commit, commit, ENV, 'commit')}</code>, Claude Code <code>${D(E.env.claude_version, E.env.claude_version, ENV, 'claude_version')}</code> and model <code>${D(E.env.model, E.env.model, ENV, 'model')}</code>, with this isolation: <q>${D(E.env.isolation, E.env.isolation, ENV, 'isolation')}</q> Grading timestamps: ${runsB}. The executor model as recorded per run: ${exB}. The grader model is confirmed <code>${D(initModels[0], initModels[0], V, 'calls[*].init_model', 'all-equal')}</code> from the streams: <code>verified-results.json</code> records that model at the start of every one of its ${D(E.v.cli_invocations, E.v.cli_invocations, V, 'cli_invocations')} CLI invocations, graders included.</p>
    <p><strong>Commits.</strong> <code>${D(commit, commit, ENV, 'commit')}</code> for this report, and <code>${D(commit9.slice(0, 7), commit9, R9PROT, 'commit ([0-9a-f]{40})', 're-prefix7')}</code> for Report 009. <code>SKILL.md</code> has the same bytes at both: sha256 <code>${D(s9, s9, R9SUMS, 'inputs/native/documentation-and-adrs/skills/documentation-and-adrs/SKILL.md', 'sha-line')}</code> in Report 009&rsquo;s <code>SHA256SUMS</code>, <code>${D(sB, sB, ENV, `source_sha256.${SKILL_REL}`, 'key')}</code> in configuration B&rsquo;s <code>environment.json</code>, and <code>${D(sA, sA, SUMS, `${A}/run-1/tree/${SKILL_REL}`, 'sha-line')}</code> for the copy configuration A ran.</p>
    <p><strong>The exploratory runs</strong> ran at <code>${D(fxCommit, fxCommit, rawA('fix-runs/run-all.sh'), 'COMMIT=([0-9a-f]{40})', 're')}</code> from <code>${D(fxS, fxS, pa('fix-runs/log.txt'), '^run 1 start (\\S+)$', 're')}</code> to <code>${D(fxE, fxE, pa('fix-runs/log.txt'), '^settings restored (\\S+)$', 're')}</code>.</p>
    <p><strong>Provenance.</strong> The pull request descriptions, the release ${D(E.gh.release.tag, E.gh.release.tag, GH, 'release.tag')} wording and issue #${D(E.gh.issue.number, E.gh.issue.number, GH, 'issue.number')}&rsquo;s state were read from GitHub&rsquo;s API at <code>${D(E.gh.checked_at, E.gh.checked_at, GH, 'checked_at')}</code>: the issue was <code>${D(E.gh.issue.state, E.gh.issue.state, GH, 'issue.state')}</code> with ${D(E.gh.issue.comments, E.gh.issue.comments, GH, 'issue.comments')} comments.</p>
`;
  return `  <h2 id="run-record">Run record</h2>
  <div class="card">
${inner}
${cite(inner)}
  </div>`;
}

function publishedFiles() {
  return [...PUBLISHED.map(([bundle, rel]) => pubName(bundle, rel)), ...TWINS.map((f) => `${PUB}/${f}`)].sort();
}


// ---- Amendment 1 (spec 041 A-041-4) ---------------------------------------------
// The counts the second fresh-context QA found typed as words with no file (O-3 to O-6),
// each now read from its file. The figures probe re-derives each by its own reader.

// O-3: the merged changes to the behavioural-evaluation harness in the check record, the
// pull requests whose title is scoped fix(evals).
function harnessPrs(E) {
  const n = E.gh.pulls.filter((p) => p.merged === true && p.title.startsWith('fix(evals)')).length;
  return D(WORD[n], n, GH, 'pulls|merged=true|title^=fix(evals)', 'count-where');
}
// The settings file's before and after sha256 files, as raw-SHA256SUMS lists them.
function settingsShaFiles() {
  const re = `^${A}/settings\\.json\\.[a-z]+\\.sha256$`;
  const n = readText(SUMS).split('\n').filter(Boolean).filter((l) => new RegExp(re).test(l.slice(66))).length;
  return D(WORD[n], n, SUMS, re, 'lines-matching');
}

// A-041-5: the outcome so far, one sentence, every value read from the third check record. It sits in
// its own card after Amendment 1's first, so the Amendments section spec 020's manifest recorded at
// 8f15c287 stays its prefix: an append, not an edit.
// A-041-7 (approval F-9): the PR body's own words, from the sentence the third record copies.
const PR_CITE = 'Per the reading in #591 (the eval is off, not the skill)';
function outcomeLine(E) {
  const g = E.gh3; const pr = g.pull; const r = g.reply;
  if (!pr.body_sentence || pr.body_sentence.source !== 'pull-598.json' || !pr.body_sentence.text.startsWith(PR_CITE)) throw new Error('the third record no longer carries the PR body sentence');
  if (pr.author !== g.issue.author || r.author !== g.issue.author) throw new Error('the PR or the reply is no longer by the account that filed the issue');
  return `    <p><strong>The outcome so far.</strong> Read again at <code>${D(g.checked_at, g.checked_at, GH3, 'checked_at')}</code>: <a href="${esc(pr.url)}">PR #${D(pr.number, pr.number, GH3, 'pull.number')}</a>, &ldquo;${D(pr.title, pr.title, GH3, 'pull.title')}&rdquo;, was opened at <code>${D(pr.created_at, pr.created_at, GH3, 'pull.created_at')}</code> by <code>${D(pr.author, pr.author, GH3, 'pull.author')}</code>, the same account that filed issue #${D(g.issue.number, g.issue.number, GH3, 'issue.number')} and ran configuration A, with a body that says &ldquo;${D(PR_CITE, PR_CITE, GH3, `pull.body_sentence.text|${PR_CITE}`, 'contains-at')}&rdquo;, and is <code>${D(pr.state, pr.state, GH3, 'pull.state')}</code> with <code>merged: ${D(String(pr.merged), pr.merged, GH3, 'pull.merged')}</code>; the same account <a href="${esc(r.url)}">replied on the issue</a> at <code>${D(r.created_at, r.created_at, GH3, 'reply.created_at')}</code>.</p>`;
}

function amendmentsSection(E) {
  const g = E.gh2;
  const i = g.issue;
  const ci = (pred) => g.comments.findIndex(pred);
  const first = 0;
  const ans = ci((c) => c.author_association === 'OWNER');
  if (ans < 0 || g.comments.length !== i.comments) throw new Error('the second check record no longer holds the maintainer comment');
  const a = g.comments[ans];
  const quote2 = 'a general-docs rule from definition-of-done.md';
  if (!a.body.includes(quote2)) throw new Error('the answer no longer carries the phrase claim 2 reads');
  const bQuote = 'not established merely by finding similar wording';
  const report = pb('report.md');
  if (!readText(report).includes(bQuote)) throw new Error("the second party's report no longer carries the provenance sentence");
  const inner = `    <p>This amendment adds to the record above and changes none of its sentences, figures or tables, though it reads a sentence of the second reading more narrowly below. The headline&rsquo;s Read-from line now also cites the ${D('five', E.a.length, E.a.map((x) => x.src), 'runs', 'tally')} configuration A grading files the headline&rsquo;s new expectation tie reads, and the evidence list names the new check records. It records the maintainer&rsquo;s answer on issue #${D(i.number, i.number, GH2, 'issue.number')}, sets out how that sentence of the second reading is read, and ties counts in the text above to the files they are read from.</p>
    <p><strong>The answer on issue #${D(i.number, i.number, GH2, 'issue.number')}.</strong> The record above says the issue was open and unanswered when checked at <code>${D(E.gh.checked_at, E.gh.checked_at, GH, 'checked_at')}</code>. That stays as published, and it was true at that check. Read again from GitHub&rsquo;s API at <code>${D(g.checked_at, g.checked_at, GH2, 'checked_at')}</code>, <a href="${esc(i.url)}">issue #${D(i.number, i.number, GH2, 'issue.number')}</a> was <code>${D(i.state, i.state, GH2, 'issue.state')}</code> with ${D(WORD[i.comments], i.comments, GH2, 'issue.comments')} comments. The first was posted at <code>${D(g.comments[first].created_at, g.comments[first].created_at, GH2, `comments[${first}].created_at`)}</code> by another contributor. The second is the maintainer&rsquo;s answer, posted by <code>${D(a.author, a.author, GH2, `comments[${ans}].author`)}</code>, whose association with the repository GitHub records as <code>${D(a.author_association, a.author_association, GH2, `comments[${ans}].author_association`)}</code>, at <code>${D(a.created_at, a.created_at, GH2, `comments[${ans}].created_at`)}</code>, and <a href="${esc(a.url)}">quoted here in full</a>:</p>
    <blockquote class="answer"><p>${D(a.body, a.body, GH2, `comments[${ans}].body`)}</p></blockquote>
    <p>This page reports what the maintainer wrote. It does not report a change to the eval and records none. The runs, the exploratory runs and the readings above are unchanged.</p>
    <p><strong>The second reading, as amended.</strong> The second reading above says the wording of the expectation that moved &ldquo;comes from&rdquo; the repository&rsquo;s <code>references/definition-of-done.md</code>. Read it as: a similar rule appears in that file. It shares the phrases &ldquo;timeless language&rdquo; and &ldquo;current state&rdquo; with the expectation, not its wording, and the files do not show where the expectation&rsquo;s wording was taken from, and the second party&rsquo;s report says that provenance is &ldquo;${D(bQuote, bQuote, report, bQuote, 'contains')}&rdquo;. The maintainer&rsquo;s answer calls the rule &ldquo;${D(quote2, quote2, GH2, `comments[${ans}].body|${quote2}`, 'contains-at')}&rdquo;. That is the maintainer&rsquo;s reading, quoted as such, and it does not by itself establish where the expectation&rsquo;s wording was taken from.</p>
    <p><strong>Counts tied.</strong> The counts the text above gave as words without naming a file now name their files, as every other figure on this page does: the merged changes to the harness, the expectation both failures fell on, the failing transcripts that were not kept, the settings file&rsquo;s sha256 files and the runs the evidence list names. The transcript and the grader input configuration B replayed stay words: its results record the replayed prompt as identical, under a single sha256, and count no transcripts. No sentence of the text changes.</p>
`;
  return `  <h2 id="amendments">Amendments</h2>
  <div class="card">
    <h3 id="amendment-1">Amendment 1, 2026-09-23</h3>
${inner}${cite(inner)}
  </div>

  <div class="card">
${outcomeLine(E)}
${cite(outcomeLine(E))}
  </div>`;
}

function evidenceBlock(E) {
  const files = publishedFiles();
  const zip = `${A}/addy-adr-confirmation.zip`;
  const nRaw = readText(SUMS).split('\n').filter(Boolean).length;
  return `  <h2 id="evidence">Published evidence</h2>
  <details class="card" open><summary><strong>The files this report makes public.</strong> The ${TW(tallies(E).total)} runs&rsquo; grading files and exit codes and the run logs, the exploratory runs&rsquo; files including the retained raw grader response, the configuration B bundle&rsquo;s results, environment and report, the GitHub check record, and the list of every raw file with its sha256.</summary>
    <ul>
${files.map((f) => `      <li><code>${esc(f)}</code><br><span class="muted">sha256 <code>${D(sha(f), sha(f), f, '', 'sha256')}</code></span></li>`).join('\n')}
    </ul>
    <p>The configuration B bundle, <code>addy-adr-confirmation.zip</code>, is not published as a file, because it carries third-party skill text: sha256 <code>${D(sumsLine(zip), sumsLine(zip), SUMS, zip, 'sha-line')}</code>. <code>raw-SHA256SUMS</code> lists all ${D(nRaw, nRaw, SUMS, '', 'lines')} files of the raw set with their sha256, the unpublished ones included. Issue: <a href="${esc(E.gh.issue.url)}"><code>${esc(E.gh.issue.url)}</code></a>.</p>
    <p class="muted">Each published copy is named for its path inside its set, with each <code>/</code> written as <code>--</code>; its sha256 is the one <code>raw-SHA256SUMS</code> lists for that path.</p>
  </details>`;
}

function citeSection(row) {
  return `  <h2 id="cite">Cite this</h2>
  <pre class="cite-this"><code>${esc(bibtex(row))}</code></pre>`;
}

function body(E, row) {
  const t = tallies(E);
  return `<main class="report">
  <h1>Report 010: repeated ADR evaluations across two Claude Code configurations</h1>
  <p class="report-type">Instrument comparison report</p>
  <div class="headline">
${headlineBlock(E, t)}
  </div>

${limitsSection(E, t)}

${backgroundSection()}

${instrumentSection(E, t)}

${provenanceSection(E)}

${resultsSection(E, t)}

${readingsSection(E, t)}

${exploratorySection(E, t)}

${runRecordSection(E)}

${evidenceBlock(E)}

${amendmentsSection(E)}

${row ? citeSection(row) : ''}

  <footer class="site"><span>Driftproof · Apache-2.0</span><span>Report 010 · Instrument comparison report</span></footer>
</main>`;
}

const shell = (main) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Driftproof: Report 010, repeated ADR evaluations across two Claude Code configurations</title>
<link rel="stylesheet" href="../../style.css">
</head>
<body>
<header class="site"><a class="brand" href="../../index.html">Driftproof</a><nav><a href="../../index.html">Home</a><a href="../../methodology.html">Methodology</a><a href="../../neutrality.html">Neutrality</a></nav></header>
${main}
</body>
</html>
`;

// The row the card, the head tags and the Cite this block read is derived from the
// page itself (as Report 009's is), so the page is rendered once without the cite
// block to derive it, then again with it. The cite block adds no field the row reads.
function buildPage(E) {
  const first = applyHeadTags(shell(body(E, null)), PAGE_REL);
  const row = reportRow(NUMBER, { pageRel: `docs/${PAGE_REL}`, html: first });
  const base = applyHeadTags(shell(body(E, row)), PAGE_REL);
  const row2 = reportRow(NUMBER, { pageRel: `docs/${PAGE_REL}`, html: base });
  if (JSON.stringify(row2) !== JSON.stringify(row)) throw new Error('the cite block moved the row it was derived from');
  return renderReportPage(base, PAGE_REL, [row]);
}

function copyEvidence() {
  fs.mkdirSync(path.join(ROOT, PUB), { recursive: true });
  for (const [bundle, rel] of PUBLISHED) {
    fs.copyFileSync(path.join(ROOT, RAW, bundle, rel), path.join(ROOT, pubName(bundle, rel)));
  }
  for (const f of TWINS) fs.copyFileSync(path.join(ROOT, SPEC_EV, f), path.join(ROOT, PUB, f));
  console.log(`  copied ${PUBLISHED.length + TWINS.length} files to ${PUB}/`);
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--evidence')) { copyEvidence(); return 0; }
  const page = buildPage(readAll());
  const out = path.join(OUT_DIR, 'index.html');
  if (args.includes('--page')) { process.stdout.write(page); return 0; }
  if (args.includes('--check')) {
    const onDisk = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : null;
    if (onDisk === page) { console.log('report 010: page matches its files'); return 0; }
    console.error('report 010: page has DRIFTED from its files');
    process.exitCode = 1;
    return 1;
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(out, page);
  console.log(`  wrote docs/${PAGE_REL}`);
  return 0;
}

if (require.main === module) main();

module.exports = { readAll, buildPage, shell, body, main, OUT_DIR, PAGE_REL, NUMBER, PUB, RAW, PUBLISHED, TWINS, pubName, publishedFiles };
