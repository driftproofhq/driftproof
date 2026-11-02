// SPDX-License-Identifier: Apache-2.0
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { sha256, sha256Canonical } = require('./canonical');
const { readReceiptFile, validateReceipt, verifyReceiptHash } = require('./receipt');
const { suiteIdentity, readRequired, SUITE_MAX_BYTES } = require('./skill');
const { placeboReading, placeboLine } = require('./verdict');
const { plainOf } = require('./plain');
const { termText } = require('./names');

const HONESTY = "One reader's picks on these pairs. It is not a measurement of the file: it moves no verdict, and it says nothing about other readers, tasks or models.";
function chanceLine(n) { return 'A reader picking at random would be right about ' + Math.round(n / 2) + ' times'; }
function blindError(message, exitCode = 2) { return Object.assign(new Error(message), { exitCode }); }
function verified(receipt) {
  if (!verifyReceiptHash(receipt)) throw blindError('receipt_hash does not verify', 4);
  if (!validateReceipt(receipt).valid) throw blindError('receipt schema is invalid', 4);
}
function archivePath(file, receipt) {
  return path.join(path.dirname(path.dirname(path.resolve(file))), 'transcripts', receipt.receipt_hash, 'answers.json');
}
function readArchive(file, receipt) {
  const name = archivePath(file, receipt);
  let fd;
  try {
    fd = fs.openSync(name, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
    const st = fs.fstatSync(fd), limit = 16777216;
    if (!st.isFile() || st.size > limit) throw new Error('not a regular archive within 16777216 bytes');
    const bytes = Buffer.alloc(st.size + 1);
    let used = 0, n;
    while (used < bytes.length && (n = fs.readSync(fd, bytes, used, bytes.length - used, null))) used += n;
    if (used > st.size) throw new Error('archive grew while reading');
    const archive = JSON.parse(bytes.subarray(0, used).toString('utf8'));
    if (!archive || !archive.answers || typeof archive.answers !== 'object' || Array.isArray(archive.answers)) throw new Error('answers map is missing');
    return archive;
  } catch (error) {
    throw blindError('Cannot read ' + name + ': ' + error.message + '. A run keeps answers with --keep-transcripts (a --quick run keeps them).');
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}
function againstOf(receipt, against) {
  const hasPlacebo = !!receipt.placebo || receipt.results.cases.some(c => c.mode === 'placebo');
  const mode = against === undefined ? (hasPlacebo ? 'placebo' : 'baseline') : against;
  if (!['placebo', 'baseline'].includes(mode)) throw blindError('--against must name baseline or placebo');
  if (mode === 'placebo' && !hasPlacebo) throw blindError('This receipt has no placebo arm');
  return mode;
}
// A-619-1: a --suite file, read once, bounded and never through a link. `bytes` go on to the stale
// check, so both read the same file.
function readSuite(file) {
  const abs = path.resolve(String(file)), base = path.basename(abs);
  try {
    const bytes = readRequired(abs, base, SUITE_MAX_BYTES, 'SUITE_MAX_BYTES');
    const raw = JSON.parse(bytes.toString('utf8')), { cases, suiteHash } = suiteIdentity(raw);
    return { file: abs, bytes, raw, cases, suiteHash };
  } catch (error) { throw Object.assign(blindError('--suite ' + base + ': ' + error.message), { code: error.code }); }
}
// Prompts by case id from a suite whose hash, recomputed here, is the receipt's. A hash handed in is
// never read.
function promptsOf(raw, receipt) {
  try {
    const suite = suiteIdentity(raw);
    if (suite.suiteHash === receipt.suite.suite_hash) return new Map(suite.cases.map(c => [c.id, c.prompt]));
  } catch { /* No suite, or not one. */ }
  return null;
}
function suiteMismatch(suite, receipt) {
  return blindError('--suite ' + path.basename(suite.file) + ': its suite hash begins ' + suite.suiteHash.slice(0, 12) + ', and this receipt\'s begins ' + String(receipt.suite.suite_hash).slice(0, 12) + '. A suite fills prompts only for the run that measured it. No record written.');
}
function pairsOf(receipt, archive, against, suite) {
  verified(receipt);
  const mode = againstOf(receipt, against), pairs = [], dropped = [];
  const rows = receipt.results.cases, answers = archive && archive.answers || {};
  // Old archives have no suite; a given suite fills prompts only when it matches.
  const fromArchive = archive && promptsOf(archive.suite, receipt);
  const given = suite ? promptsOf(suite.raw !== undefined ? suite.raw : { cases: suite.cases }, receipt) : null;
  const fromGiven = !fromArchive && given;
  const prompts = fromArchive || fromGiven || new Map();
  for (const row of rows.filter(c => c.mode === 'with_skill')) {
    const other = rows.find(c => c.id === row.id && c.mode === mode);
    for (const draw of row.generation && row.generation.draws || []) {
      if (draw.status !== 'measured') continue;
      const counterpart = other && other.generation && other.generation.draws.find(d => d.draw_index === draw.draw_index);
      let reason = !counterpart || counterpart.status !== 'measured' ? 'matching measured ' + mode + ' draw missing' : null;
      if (!reason && (!Number.isFinite(draw.mean) || !Number.isFinite(counterpart.mean))) reason = 'recorded draw score missing';
      if (!reason) for (const d of [draw, counterpart]) {
        if (typeof answers[d.generation_hash] !== 'string') { reason = 'kept answer missing'; break; }
        if (sha256(answers[d.generation_hash]) !== d.generation_hash) { reason = 'kept answer hash mismatch'; break; }
      }
      if (reason) { dropped.push({ id: row.id, draw_index: draw.draw_index, reason }); continue; }
      pairs.push({ id: row.id, draw_index: draw.draw_index,
        prompt: prompts.get(row.id) || 'Task prompt not kept in this archive.',
        with_answer: answers[draw.generation_hash], against_answer: answers[counterpart.generation_hash],
        with_mean: draw.mean, against_mean: counterpart.mean });
    }
  }
  return { against: mode, pairs, dropped, prompts_from: fromArchive ? 'archive' : fromGiven ? 'suite' : null, suite_matched: suite ? !!given : null };
}
function tallyOf(rows) {
  return { picked_correct: rows.filter(r => (r.pick === 'A' && r.shown_first === 'with_skill') || (r.pick === 'B' && r.shown_first !== 'with_skill')).length, pairs_total: rows.length };
}
function judgeReadingOf(pairs) {
  const judge = { higher: 0, lower: 0, same: 0 };
  for (const p of pairs) judge[p.with_mean > p.against_mean ? 'higher' : p.with_mean < p.against_mean ? 'lower' : 'same']++;
  return judge;
}
function readingLine(receipt) {
  return receipt.placebo || receipt.results.cases.some(c => c.mode === 'placebo') ? placeboLine(placeboReading(receipt)) : plainOf(receipt).sentence;
}
function resultLines(record, receipt) {
  const j = record.judge;
  return ["You picked the file's answer " + record.picked_correct + ' of ' + record.pairs_total + ' times', chanceLine(record.pairs_total),
    "the judge scored the file's answer higher in " + j.higher + ', lower in ' + j.lower + ', the same in ' + j.same, readingLine(receipt), HONESTY];
}
function safeIds(pairs) {
  if (pairs.some(p => !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(p.id))) throw blindError('Case identifiers must be plain labels to keep paths and personal text out of the record');
}
function makeRecord(receipt, against, rows, judge) {
  safeIds(rows);
  const pairs = rows.map(r => ({ id: r.id, draw_index: r.draw_index, shown_first: r.shown_first, pick: r.pick,
    correct: (r.pick === 'A') === (r.shown_first === 'with_skill') }));
  const record = { format: 'driftproof-blind/1', receipt_hash: receipt.receipt_hash, against, date_utc: new Date().toISOString(), pairs,
    ...tallyOf(pairs), judge };
  return { ...record, sha256: sha256Canonical(record) };
}
function outputPath(file, out) {
  const target = out === undefined ? path.join(path.dirname(file), path.basename(file, '.json') + '.blind.json') : out;
  if (typeof target !== 'string' || !target.endsWith('.blind.json') || path.resolve(path.dirname(target)) !== path.resolve(path.dirname(file))) throw blindError('--out must name a .blind.json file beside the receipt');
  return target;
}
function writeRecord(file, record, out) {
  const target = outputPath(file, out), base = target.slice(0, -'.blind.json'.length);
  for (let n = 1; ; n++) {
    const name = n === 1 ? target : base + '-' + n + '.blind.json';
    try { fs.writeFileSync(name, JSON.stringify(record, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); return name; }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
}
function dropLine(dropped) {
  const counts = new Map();
  for (const d of dropped) counts.set(d.reason, (counts.get(d.reason) || 0) + 1);
  return 'Dropped ' + dropped.length + ' pairs' + (dropped.length ? ': ' + [...counts].map(([why, n]) => n + ' ' + why).join('; ') : '') + '.';
}
async function runBlind(file, flags = {}, io = {}) {
  let receipt;
  try { receipt = readReceiptFile(file); verified(receipt); } catch (error) { throw blindError(path.basename(file) + ': ' + error.message, error.exitCode || 2); }
  const against = againstOf(receipt, flags.against);
  if (flags.pairs !== undefined && (typeof flags.pairs !== 'string' || !/^[1-9][0-9]*$/.test(flags.pairs) || !Number.isSafeInteger(Number(flags.pairs)))) throw blindError('--pairs needs a positive integer');
  outputPath(file, flags.out);
  let suite;
  if (flags.suite !== undefined) {
    if (typeof flags.suite !== 'string' || !flags.suite) throw blindError('--suite needs a file');
    suite = readSuite(flags.suite);
    if (suite.suiteHash !== receipt.suite.suite_hash) throw suiteMismatch(suite, receipt);
  }
  const paired = pairsOf(receipt, readArchive(file, receipt), against, suite);
  const pairs = paired.pairs.slice(0, flags.pairs === undefined ? undefined : Number(flags.pairs));
  safeIds(pairs);
  if (!(io.isTTY === undefined ? process.stdin.isTTY : io.isTTY)) throw blindError('A terminal is needed. Use driftproof view for the page form.');
  if (!pairs.length) throw blindError(dropLine(paired.dropped) + ' No verified pairs available.');
  const print = io.print || (s => console.log(termText(s))), coin = io.coin || (() => crypto.randomBytes(1)[0] & 1);
  let rl, iterator;
  if (!io.ask) { rl = require('node:readline').createInterface({ input: process.stdin, output: process.stdout }); iterator = rl[Symbol.asyncIterator](); }
  const ask = io.ask || (async () => { const next = await iterator.next(); return next.done ? null : next.value; });
  const rows = [];
  try {
    print(dropLine(paired.dropped));
    for (const p of pairs) {
      const first = coin() ? against : 'with_skill';
      print(p.prompt);
      for (const line of require('./view').sideBySide(first === 'with_skill' ? p.with_answer : p.against_answer, first === 'with_skill' ? p.against_answer : p.with_answer, 38, ['Answer A', 'Answer B'])) print(line);
      let pick;
      do {
        print('Which answer used ' + receipt.skill.name + '? Enter A or B.');
        const answer = await ask(); if (answer === null || answer === undefined) throw blindError('Input ended; no record written.');
        pick = String(answer).trim().toUpperCase();
      } while (!['A', 'B'].includes(pick));
      rows.push({ id: p.id, draw_index: p.draw_index, shown_first: first, pick });
    }
  } finally { if (rl) rl.close(); }
  const record = makeRecord(receipt, against, rows, judgeReadingOf(pairs));
  const written = writeRecord(file, record, flags.out);
  resultLines(record, receipt).forEach(print);
  print('Record: ' + path.basename(written));
  return record;
}

// Runs inside the existing offline view runtime. All untrusted text uses textContent.
// A-619-1: one pair at a time. Each pair's coin is thrown once, at mount, so its A and B stay put;
// no arm name reaches the pairs' text or attributes until Reveal.
function mountBlind(el) {
  const data = JSON.parse(el.querySelector('[data-blind-data]').textContent);
  const area = el.querySelector('[data-blind-pairs]'), result = el.querySelector('[data-blind-result]');
  const prev = el.querySelector('[data-blind-prev]'), next = el.querySelector('[data-blind-next]'), status = el.querySelector('[data-blind-status]');
  const rows = [], fields = [];
  let revealed = false, current = 0;
  function text(tag, value, parent) { const node = document.createElement(tag); node.textContent = value; parent.appendChild(node); return node; }
  function show(i) {
    current = i; fields.forEach((f, j) => { f.hidden = j !== i; });
    prev.disabled = i === 0; next.disabled = i >= fields.length - 1;
  }
  function tell() {
    const n = rows.filter(r => r.pick).length;
    status.textContent = revealed ? '' : n === rows.length ? 'All ' + n + ' pairs picked. Press Reveal to see the mapping.' : 'Picked ' + n + ' of ' + rows.length + ' pairs.';
  }
  function reveal() {
    if (revealed) return; revealed = true; tell();
    const sheet = el.closest('.sheet'), look = sheet && sheet.querySelector('[data-blind-look]');
    if (look) look.open = true;
    const answered = rows.filter(r => r.pick), pairs = data.pairs.filter((p, i) => rows[i].pick);
    const judge = { higher: 0, lower: 0, same: 0 };
    pairs.forEach(p => judge[p.with_mean > p.against_mean ? 'higher' : p.with_mean < p.against_mean ? 'lower' : 'same']++);
    const record = { format: 'driftproof-blind/1', receipt_hash: data.receipt_hash, against: data.against, date_utc: new Date().toISOString(),
      pairs: answered, picked_correct: answered.filter(r => r.correct).length, pairs_total: answered.length, judge };
    fields.forEach((f, i) => { f.disabled = true; text('p', 'The file used Answer ' + (rows[i].shown_first === 'with_skill' ? 'A' : 'B'), f); });
    text('p', "You picked the file's answer " + record.picked_correct + ' of ' + record.pairs_total + ' times', result);
    text('p', 'A reader picking at random would be right about ' + Math.round(record.pairs_total / 2) + ' times', result);
    text('p', "the judge scored the file's answer higher in " + judge.higher + ', lower in ' + judge.lower + ', the same in ' + judge.same, result);
    text('p', data.reading, result); text('p', data.honesty, result);
    text('p', 'Skipped ' + (rows.length - answered.length) + ' pairs.', result);
    const label = text('label', 'Record (select and copy)', result), box = document.createElement('textarea');
    box.readOnly = true; box.rows = 10; box.style.width = '100%'; box.value = JSON.stringify(record, null, 2); label.appendChild(box);
    box.addEventListener('focus', () => box.select()); result.hidden = false;
    el.querySelector('[data-blind-reveal]').disabled = true;
  }
  data.pairs.forEach((p, i) => {
    const first = crypto.getRandomValues(new Uint8Array(1))[0] & 1 ? data.against : 'with_skill';
    const row = { id: p.id, draw_index: p.draw_index, shown_first: first, pick: null, correct: false }; rows.push(row);
    const field = document.createElement('fieldset'); fields.push(field); area.appendChild(field);
    text('legend', 'Pair ' + (i + 1) + ' of ' + data.pairs.length + ': which answer used ' + data.skill + '?', field);
    text('p', p.prompt, field).className = 'blind-prompt';
    const panes = document.createElement('div'), picks = document.createElement('div');
    panes.className = 'blind-panes'; picks.className = 'blind-picks'; field.appendChild(panes); field.appendChild(picks);
    ['A', 'B'].forEach((letter, j) => {
      const col = document.createElement('div'); col.className = 'blind-col'; panes.appendChild(col);
      text('h5', 'Answer ' + letter, col);
      text('pre', (j === 0) === (first === 'with_skill') ? p.with_answer : p.against_answer, col).setAttribute('data-blind-pane', '');
      const label = document.createElement('label'), input = document.createElement('input');
      input.type = 'radio'; input.name = 'blind-' + data.instance + '-' + i; input.value = letter;
      label.appendChild(input); label.appendChild(document.createTextNode('Answer ' + letter)); picks.appendChild(label);
      input.addEventListener('change', () => {
        if (revealed) return;
        row.pick = letter; row.correct = (letter === 'A') === (first === 'with_skill');
        tell();
      });
    });
  });
  prev.addEventListener('click', () => { if (current > 0) show(current - 1); });
  next.addEventListener('click', () => { if (current < fields.length - 1) show(current + 1); });
  el.querySelector('[data-blind-reveal]').addEventListener('click', reveal);
  el.querySelector('[data-blind-nav]').hidden = false;
  show(0); tell();
}
module.exports = { pairsOf, tallyOf, judgeReadingOf, readArchive, readSuite, suiteMismatch, runBlind, HONESTY, chanceLine, resultLines, makeRecord, writeRecord, readingLine, dropLine, mountBlind, safeIds };
