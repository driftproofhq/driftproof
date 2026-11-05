#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';
// Site builder: {}
// Issue 690 (spec 690): the question and the judge's notes behind every task score. For each row of
// Reports 017 and 018 that has a sealed receipt, one data file, docs/reports/<NNN>/notes/<attempt>.json,
// holds what the island shows when a task name is opened: the task's prompt and rubric from the suite
// whose recomputed hash the receipt seals, and for every try the kept answer with the skill, with the
// fake text and with nothing, each with the judge's scores and reasons as the receipt seals them.
// The rows come through the report builders' own readCampaign (seal, schema, reconstruction); every
// answer is hashed against its draw's generation_hash, every judge output against its recorded hash,
// and every score parsed with the runner's own parser. Nothing here reads a verdict, adds a number,
// or writes a receipt, an answers file or a suite.
//   node scripts/build-judge-notes.js [--check]
const fs = require('node:fs'), path = require('node:path');
const C = require('../specs/408-skill-measurements/campaign.cjs');
const blind = require('../lib/blind');
const { sha256 } = require('../lib/canonical');
const { scoreOf } = require('../lib/judge');
const { extractJsonObject } = require('../lib/json');
const policy = require('../lib/report-015-publication');
const skillHandoff = require('./skill-handoff');
const { humanModelName } = require('./model-names');
const ROOT = path.join(__dirname, '..');
const SUITES = path.join(ROOT, 'specs/408-skill-measurements/suites');
const REPO = 'https://github.com/driftproofhq/driftproof/blob/main/';
const FORMAT = 'driftproof-judge-notes/1';
const need = C.need;
// The arms, in the order the panel shows them, with their plain labels (spec 690 AC-8).
const ARMS = [['with_skill', 'With the skill'], ['placebo', 'With the fake text'], ['baseline', 'With nothing']];
// The two reports, each read through the builder that owns its chain (spec 690 AC-1), and the words
// each carries beside every reading (AC-6): the "beating the fake" caveat of both, and Report 018's
// same-model limitation, the plan's pinned string in lib/receipt.js's words.
const REPORTS = {
  '017': { builder: './prepare-report-017.js', options: () => ({ handoff: [...skillHandoff.ATTEMPTS] }), limitation: () => null },
  '018': { builder: './prepare-report-018.js', options: () => ({}), limitation: (R) => R.LIMITATION },
};
function reportOf(number) {
  const spec = REPORTS[number]; need(spec, 'REPORT_UNKNOWN');
  const R = require(spec.builder);
  return { R, caveat: R.CAVEAT, limitation: spec.limitation(R), rows: () => R.readCampaign({ campaignRoot: path.join(ROOT, R.CAMPAIGN), ...spec.options() }).rows };
}
// The panel's own caveats (spec 690 AC-6): the reasons are a model's words, and one task is one of few.
const MODEL_WORDS = "The scores and reasons are the judge model's own words, kept exactly as it wrote them. They are a model's reading of the rubric, not Driftproof's.";
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const word = (n) => (n >= 0 && n < WORDS.length ? WORDS[n] : String(n));
const taskCountLine = (n) => 'This is one task of ' + word(n) + '. Each skill was given ' + word(n) + ' text tasks, and one task is not the whole measurement.';
const routerLine = () => policy.REASON + ' Report 015 Amendment 1. Left out of the headline count.';
const dayOf = (d) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(d));
const rel = (f) => path.relative(ROOT, f).split(path.sep).join('/');

// The suite whose hash, recomputed by readSuite, is the receipt's. A file name is never read (AC-4).
function suiteFor(receipt, suitesDir = SUITES) {
  const hits = [];
  for (const name of fs.readdirSync(suitesDir).filter((n) => n.endsWith('.json')).sort()) {
    let suite; try { suite = blind.readSuite(path.join(suitesDir, name)); } catch { continue; }
    if (suite.suiteHash === receipt.suite.suite_hash) hits.push(suite);
  }
  need(hits.length > 0, 'SUITE_BINDING');
  return hits[0];
}

// One retained judge output, read as the runner reads it: the score lib/judge.js scoreOf gives, the
// pass flag and the reason as the object carries them, the reason whole (AC-3).
function noteOf(output) {
  let parsed; try { parsed = extractJsonObject(output); } catch { need(false, 'JUDGE_BINDING'); }
  const score = scoreOf(parsed);
  need(typeof score === 'number', 'JUDGE_BINDING');
  return { score, pass: typeof parsed.pass === 'boolean' ? parsed.pass : null, reason: typeof parsed.reason === 'string' ? parsed.reason : null };
}

// One row's data: the receipt's cases by task and arm, every draw as a try (AC-2, AC-3, AC-5).
function notesOf({ number, row, answers, suite, root = ROOT }) {
  const receipt = row.receipt;
  need(receipt && answers && typeof answers === 'object' && answers.receipt_hash === receipt.receipt_hash, 'ANSWERS_BINDING');
  const kept = answers.answers || {}, draws = Array.isArray(answers.draws) ? answers.draws : [];
  const tasks = suite.cases.map((c, i) => {
    const cases = ARMS.map(([mode]) => receipt.results.cases.find((x) => x.id === c.id && x.mode === mode));
    need(cases.every(Boolean), 'ANSWER_BINDING');
    const most = Math.max(...cases.map((x) => Math.max(...x.generation.draws.map((d) => d.draw_index)))) + 1;
    const tries = Array.from({ length: most }, (_, k) => ({ try: k + 1 }));
    ARMS.forEach(([mode], a) => {
      for (const t of tries) t[mode] = null;
      for (const d of cases[a].generation.draws) {
        const answer = kept[d.generation_hash];
        need(typeof answer === 'string' && sha256(answer) === d.generation_hash, 'ANSWER_BINDING');
        const ev = draws.find((x) => x.id === c.id && x.mode === mode && x.draw_index === d.draw_index);
        need(ev && Array.isArray(ev.judge_outputs) && Array.isArray(d.judge_sample_hashes) && ev.judge_outputs.length === d.judge_sample_hashes.length, 'JUDGE_BINDING');
        const notes = ev.judge_outputs.map((out, k) => {
          need(sha256(out) === d.judge_sample_hashes[k], 'JUDGE_BINDING');
          const note = noteOf(out);
          need(note.score === d.samples[k], 'JUDGE_BINDING');
          return note;
        });
        need(typeof d.mean === 'number', 'JUDGE_BINDING');
        tries[d.draw_index][mode] = { answer, average: d.mean, notes };
      }
    });
    return { id: c.id, number: i + 1, of: suite.cases.length, prompt: c.prompt, rubric: c.rubric, pass_threshold: c.pass_threshold, tries };
  });
  const words = reportOf(number);
  const caveats = [...(words.limitation ? [words.limitation] : []), words.caveat, MODEL_WORDS, taskCountLine(suite.cases.length)];
  if (row.handoffNote) caveats.push(row.handoffNote);
  if (row.router) caveats.push(routerLine());
  need(caveats.every((s) => typeof s === 'string' && s.length > 0), 'CAVEAT_BINDING');
  const page = path.join(root, 'docs', 'r', receipt.receipt_hash, 'index.html');
  return {
    format: FORMAT, report: number, report_url: '/reports/' + number + '/', attempt_id: row.attempt_id, skill: row.skill, repository: row.repository,
    receipt_hash: receipt.receipt_hash, receipt_page: fs.existsSync(page) ? '/r/' + receipt.receipt_hash + '/' : null,
    receipt_file: REPO + row.src, answers_file: REPO + row.src.replace(/\.json$/, '-answers.json'), suite_file: REPO + rel(suite.file),
    model: humanModelName(receipt.run.model_id), judge: humanModelName(receipt.run.judge.model_id), judge_samples: receipt.run.judge.samples, date: dayOf(receipt.run.date_utc),
    arms: ARMS.map(([key, label]) => ({ key, label })), caveats, tasks,
  };
}

function outputs(opts = {}) {
  const out = path.resolve(opts.out || path.join(ROOT, 'docs')), suitesDir = opts.suitesDir || SUITES, files = [];
  for (const number of Object.keys(REPORTS)) {
    for (const row of reportOf(number).rows()) {
      if (!row.receipt) continue;
      const answers = C.read(path.join(ROOT, row.src.replace(/\.json$/, '-answers.json')));
      const data = notesOf({ number, row, answers, suite: suiteFor(row.receipt, suitesDir) });
      files.push({ file: path.join(out, 'reports', number, 'notes', row.attempt_id + '.json'), text: JSON.stringify(data, null, 1) + '\n' });
    }
  }
  return files;
}
function write(opts = {}) {
  const files = outputs(opts);
  for (const f of files) { fs.mkdirSync(path.dirname(f.file), { recursive: true }); fs.writeFileSync(f.file, f.text); }
  return files;
}
function check(opts = {}) {
  const files = outputs(opts);
  for (const f of files) need(fs.existsSync(f.file) && fs.readFileSync(f.file, 'utf8') === f.text, 'JUDGE_NOTES_DRIFT');
  // A file the builder would not write is a drift too: the set is exactly the rows with a receipt.
  for (const number of Object.keys(REPORTS)) {
    const dir = path.join(path.resolve(opts.out || path.join(ROOT, 'docs')), 'reports', number, 'notes');
    const want = files.filter((f) => path.dirname(f.file) === dir).map((f) => path.basename(f.file)).sort();
    need(JSON.stringify(fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []) === JSON.stringify(want), 'JUDGE_NOTES_DRIFT');
  }
  return files;
}

function main(argv = process.argv.slice(2)) {
  for (const a of argv) if (a !== '--check') C.fail('ARGUMENT');
  const isCheck = argv.includes('--check');
  const files = (isCheck ? check : write)();
  console.log('judge notes: ' + files.length + ' data files ' + (isCheck ? 'match the receipts' : 'written from the receipts'));
}
module.exports = { FORMAT, ARMS, MODEL_WORDS, taskCountLine, routerLine, suiteFor, noteOf, notesOf, outputs, write, check, main };
if (require.main === module) try { main(); } catch (e) { console.error('judge notes: refused: ' + (e.code || e.message)); process.exitCode = 1; }
