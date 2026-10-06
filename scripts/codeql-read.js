#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';
// scripts/codeql-read.js - the reader for the local CodeQL scan (spec 148).
//
// scripts/codeql-local.sh runs the CodeQL CLI; this reads what it wrote. It lists results by rule,
// file and line, sets them against the recorded baseline, and says whether the release sweep stops.
//
//   node scripts/codeql-read.js list <results.sarif>
//   node scripts/codeql-read.js check <results.sarif> --root <scanned-dir> [--baseline <file>] [--json <out>]
//                                         exit 0 nothing new, 1 a result off the baseline, 2 not readable
//   node scripts/codeql-read.js export <tree> <dest> [--rev <sha>]
//                                         the files the public build publishes, copied into <dest>
//   node scripts/codeql-read.js pin <field>        a field of config/codeql.json, e.g. cli.version
//   node scripts/codeql-read.js baseline <results.sarif> --root <scanned-dir> --dismissals <file> [--source <words>]
//                                         config/codeql-baseline.json, joined from a scan and the
//                                         operator's dismissals record, printed to stdout
//
// THE TREE SCANNED is the tree the public build publishes: `git ls-files` less EXCLUDE_RE, read out
// of scripts/build-public.sh at the moment it is used, never copied here.
//
// A RESULT IS ON THE BASELINE when its rule, its file and the text of its line (trimmed, hashed)
// all match an entry. The line number is for reading only, so an edit elsewhere in a file does not
// move it; an edit to the flagged line does, and the result is then new until someone has looked.
// A baseline entry the scan no longer reads is reported as gone and does not stop the sweep.
//
// A SCAN THAT CANNOT BE READ IS NOT A CLEAN ONE. The reader exits 2 when the file is not SARIF 2.1.0
// from CodeQL, when the tool says its run failed, when it extracted no file, or when a result sits in
// a file the scanned directory does not hold.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PIN = 'config/codeql.json';
const BASELINE = 'config/codeql-baseline.json';
const PUBLISH = 'scripts/build-public.sh';

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const git = (root, args, o = {}) => execFileSync('git', ['-C', root, ...args], { maxBuffer: 256 * 1024 * 1024, ...o });

// ── the pin ──────────────────────────────────────────────────────────────────────────────────
function pinOf(field, root = ROOT) {
  let v = readJson(path.join(root, PIN));
  for (const k of field.split('.')) {
    if (v === null || typeof v !== 'object' || !(k in v)) throw new Error(`${PIN} has no field ${field}`);
    v = v[k];
  }
  return v;
}

// ── the published tree ───────────────────────────────────────────────────────────────────────
function publishPattern(text) {
  const m = /EXCLUDE_RE='([^']+)'/.exec(text);
  if (!m) throw new Error(`cannot read EXCLUDE_RE out of ${PUBLISH}`);
  return new RegExp(m[1]);
}
// The files the public build copies at `rev` (the working tree's index when there is none).
function publishedFiles(root, rev = null) {
  const script = rev ? git(root, ['show', `${rev}:${PUBLISH}`]).toString('utf8') : fs.readFileSync(path.join(root, PUBLISH), 'utf8');
  const names = (rev ? git(root, ['ls-tree', '-r', '-z', '--name-only', rev]) : git(root, ['ls-files', '-z'])).toString('utf8').split('\0').filter(Boolean);
  const ex = publishPattern(script);
  return names.filter((n) => !ex.test(n));
}
// Copy those files into dest. At a rev they come from `git archive`, so the working tree is never
// read; otherwise from the tree itself, a symlink copied as a link.
function exportPublished(root, dest, rev = null) {
  const files = publishedFiles(root, rev);
  fs.mkdirSync(dest, { recursive: true });
  if (rev) {
    for (let i = 0; i < files.length; i += 400) {
      const tar = git(root, ['archive', '--format=tar', rev, '--', ...files.slice(i, i + 400)]);
      execFileSync('tar', ['-x', '-C', dest], { input: tar, maxBuffer: 256 * 1024 * 1024 });
    }
  } else {
    for (const f of files) {
      const from = path.join(root, f);
      const to = path.join(dest, f);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      const st = fs.lstatSync(from);
      if (st.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(from), to);
      else fs.copyFileSync(from, to);
    }
  }
  return files;
}

// ── the scan ─────────────────────────────────────────────────────────────────────────────────
function lineText(root, file, line) {
  const abs = path.join(root, file);
  if (!abs.startsWith(path.resolve(root) + path.sep)) throw new Error(`the result names ${file}, which is outside the scanned directory`);
  if (!fs.existsSync(abs)) throw new Error(`the result names ${file}, which the scanned directory does not hold`);
  const lines = fs.readFileSync(abs, 'utf8').split('\n');
  if (!(line >= 1 && line <= lines.length)) throw new Error(`the result names ${file}:${line}, past the file's ${lines.length} lines`);
  return lines[line - 1].trim();
}
function readSarif(file) {
  let doc;
  try { doc = readJson(file); } catch (e) { throw new Error(`${path.basename(file)} is not JSON: ${e.message}`); }
  if (!doc || doc.version !== '2.1.0' || !Array.isArray(doc.runs) || doc.runs.length === 0) throw new Error(`${path.basename(file)} is not SARIF 2.1.0 with a run`);
  for (const run of doc.runs) {
    if (!run.tool || !run.tool.driver || run.tool.driver.name !== 'CodeQL') throw new Error('the run was not made by CodeQL');
    const inv = (run.invocations || [])[0];
    if (!inv || inv.executionSuccessful !== true) throw new Error('CodeQL says its run did not succeed');
    if (!Array.isArray(run.artifacts) || run.artifacts.length === 0) throw new Error('CodeQL extracted no file');
    if (!Array.isArray(run.results)) throw new Error('the run carries no results array');
  }
  return doc;
}
// Every result, with the hash of its trimmed line when a scanned directory is given.
function resultsOf(doc, root = null) {
  const out = [];
  for (const run of doc.runs) {
    for (const r of run.results) {
      const loc = r.locations && r.locations[0] && r.locations[0].physicalLocation;
      if (!loc || !loc.artifactLocation || !loc.region || !loc.region.startLine) throw new Error(`a ${r.ruleId} result has no file and line`);
      const file = String(loc.artifactLocation.uri).replace(/^\.\//, '');
      const row = { rule: r.ruleId, file, line: loc.region.startLine, column: loc.region.startColumn || 1, message: String((r.message && r.message.text) || '') };
      if (root) row.text_sha256 = sha(lineText(root, file, row.line));
      out.push(row);
    }
  }
  return out;
}
const byPlace = (a, b) => a.rule.localeCompare(b.rule) || a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column;
const keyOf = (r) => `${r.rule}|${r.file}|${r.text_sha256}`;

// Results against the baseline: { total, on_baseline, new, gone }. Entries are matched one to one,
// so two results with the same rule, file and line text need two entries.
function compare(results, baseline) {
  const left = new Map();
  for (const e of baseline.entries) {
    const k = keyOf(e);
    if (!left.has(k)) left.set(k, []);
    left.get(k).push(e);
  }
  const on = [];
  const fresh = [];
  for (const r of [...results].sort(byPlace)) {
    const list = left.get(keyOf(r));
    if (list && list.length) on.push({ ...r, alert: list.shift().alert });
    else fresh.push(r);
  }
  const gone = [...left.values()].flat();
  return { total: results.length, on_baseline: on, new: fresh, gone };
}

function listText(results) {
  const lines = [];
  let rule = null;
  const sorted = [...results].sort(byPlace);
  for (const r of sorted) {
    if (r.rule !== rule) { rule = r.rule; lines.push(`${rule} (${sorted.filter((x) => x.rule === rule).length})`); }
    lines.push(`  ${r.file}:${r.line}  ${r.message.replace(/\s+/g, ' ').slice(0, 110)}`);
  }
  return lines.join('\n');
}

// The summary the sweep reads: state 'clean' or 'new', never 'unreadable' (that is an exit 2 with no summary).
function summarize(doc, root, baseline) {
  const results = resultsOf(doc, root);
  const c = compare(results, baseline);
  return {
    state: c.new.length ? 'new' : 'clean',
    total: c.total,
    on_baseline: c.on_baseline.length,
    gone: c.gone.map((e) => ({ alert: e.alert, rule: e.rule, file: e.file, line: e.line })),
    new: c.new.map(({ rule, file, line, message }) => ({ rule, file, line, message })),
    extracted_files: doc.runs.reduce((n, run) => n + run.artifacts.length, 0),
    tool: doc.runs[0].tool.driver.semanticVersion || null,
  };
}

// ── the sweep's lines (scripts/nightly.mjs prints these) ─────────────────────────────────────
function sweepLines(cq, max = 5) {
  if (cq.state === 'not-run') return [`CodeQL (local scan): not run, ${cq.why}.`];
  if (cq.state === 'unreadable') return [`CodeQL (local scan): NOT READ, ${cq.why}.`];
  const s = cq.summary;
  const lines = [`CodeQL (local scan, default suite, ${s.tool ? `CLI ${s.tool}, ` : ''}${s.extracted_files} files): ${s.total} results, ${s.on_baseline} on the baseline, ${s.new.length} new${s.gone.length ? `, ${s.gone.length} baseline entries no longer read` : ''}.`];
  for (const n of s.new.slice(0, max)) lines.push(`  - ${n.rule} ${n.file}:${n.line}`);
  if (s.new.length > max) lines.push(`  - ... and ${s.new.length - max} more in ${cq.out ? 'summary.json' : 'the summary'}`);
  return lines;
}
// null when the scan alone does not decide the verdict.
function sweepVerdict(cq) {
  if (cq.state === 'new') return 'RED';
  if (cq.state === 'unreadable') return 'ERROR';
  return null;
}

// ── the baseline, joined from a scan and the operator's dismissals record ────────────────────
// The record lists "- #N path:line" under a heading `Dismiss as "<category>" (<note>):`. The alert's
// line in the record is the line when it was dismissed; a file moves, so the entries of one file are
// matched to that file's results in order, and the counts must agree.
function readDismissals(text) {
  const out = [];
  let head = null;
  for (const l of text.split('\n')) {
    const h = /^Dismiss as "([^"]+)"(?: \((.*)\))?:\s*$/.exec(l);
    if (h) { head = { category: h[1], note: h[2] || null }; continue; }
    if (l && !l.startsWith('- ')) head = null;
    const e = /^- #(\d+) (\S+?):(\d+)\s*$/.exec(l);
    if (e && head) out.push({ alert: Number(e[1]), file: e[2], line_was: Number(e[3]), dismissal: head.category, note: head.note });
  }
  return out;
}
function buildBaseline(doc, root, dismissalsText, { source }) {
  const dismissed = readDismissals(dismissalsText);
  if (!dismissed.length) throw new Error('the dismissals record lists no dismissed alert');
  const results = resultsOf(doc, root);
  const entries = [];
  for (const file of [...new Set(dismissed.map((d) => d.file))]) {
    const want = dismissed.filter((d) => d.file === file).sort((a, b) => a.line_was - b.line_was);
    const got = results.filter((r) => r.file === file).sort((a, b) => a.line - b.line || byPlace(a, b));
    if (want.length !== got.length) throw new Error(`${file}: the record dismisses ${want.length} alert(s) and the scan reads ${got.length} result(s)`);
    want.forEach((d, i) => entries.push({
      alert: d.alert, rule: got[i].rule, file, line: got[i].line, line_was: d.line_was, text_sha256: got[i].text_sha256,
      dismissal: d.dismissal, reason: d.note ? `${d.dismissal}: ${d.note}` : d.dismissal,
    }));
  }
  entries.sort((a, b) => a.alert - b.alert);
  const claimed = new Set(entries.map((e) => `${e.rule}|${e.file}|${e.line}`));
  const extra = results.filter((r) => !claimed.has(`${r.rule}|${r.file}|${r.line}`));
  return {
    about: 'The results the local CodeQL scan accepts: the alerts the operator dismissed in the Security tab, each with the reason given. Generated by `node scripts/codeql-read.js baseline`; a result off this list stops the release sweep.',
    source,
    scan: { cli: doc.runs[0].tool.driver.semanticVersion, results: results.length, results_off_the_record: extra.length },
    entries,
  };
}

// ── command line ─────────────────────────────────────────────────────────────────────────────
function main(argv) {
  const [cmd, ...rest] = argv;
  const flag = (k) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : null; };
  const pos = rest.filter((a, i) => !a.startsWith('--') && !(i > 0 && rest[i - 1].startsWith('--')));
  const root = flag('--root');
  if (cmd === 'pin') { process.stdout.write(`${pinOf(pos[0])}\n`); return 0; }
  if (cmd === 'export') {
    const files = exportPublished(path.resolve(pos[0]), path.resolve(pos[1]), flag('--rev'));
    process.stdout.write(`${files.length} files\n`);
    return 0;
  }
  if (cmd === 'list') {
    process.stdout.write(`${listText(resultsOf(readSarif(pos[0]), root))}\n`);
    return 0;
  }
  if (cmd === 'check') {
    let summary;
    try {
      if (!root) throw new Error('check needs --root, the directory that was scanned');
      summary = summarize(readSarif(pos[0]), root, readJson(flag('--baseline') || path.join(ROOT, BASELINE)));
    } catch (e) {
      process.stderr.write(`codeql-read: not readable: ${e.message}\n`);
      return 2;
    }
    if (flag('--json')) fs.writeFileSync(flag('--json'), `${JSON.stringify(summary, null, 2)}\n`);
    process.stdout.write(`${sweepLines({ state: summary.state, summary }, 50).join('\n')}\n`);
    return summary.state === 'clean' ? 0 : 1;
  }
  if (cmd === 'baseline') {
    const text = fs.readFileSync(flag('--dismissals'), 'utf8');
    // The record's own first line names it; the path to it is not written into a file that is published.
    const source = flag('--source') || (/^# (.+)$/m.exec(text) || [])[1];
    if (!source) throw new Error('the record has no first heading to name it by; pass --source <words>');
    const out = buildBaseline(readSarif(pos[0]), root, text, { source });
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
    return 0;
  }
  process.stderr.write('usage: codeql-read.js list|check|export|pin|baseline ... (see the head of this file)\n');
  return 2;
}

module.exports = { pinOf, publishPattern, publishedFiles, exportPublished, readSarif, resultsOf, compare, listText, summarize, sweepLines, sweepVerdict, readDismissals, buildBaseline };

if (require.main === module) {
  let code;
  try { code = main(process.argv.slice(2)); } catch (e) { process.stderr.write(`codeql-read: ${e.message}\n`); code = 2; }
  process.exit(code);
}
