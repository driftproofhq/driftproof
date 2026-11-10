// SPDX-License-Identifier: Apache-2.0
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const { createHash } = require('node:crypto');
const { loadSubject, readRequired, parseSkillMeta } = require('./skill');
const { validateReceipt, verifyReceiptHash, fileSlug } = require('./receipt');
const { runSkillOnModel, projectCalls, assertSubjectFits, resolveCallTimeoutMs } = require('./run');
const { estimateRunCostUSD, BudgetTracker } = require('./cost');
const { assertRegistered } = require('./models');
const { surfaceForModel, isSubscriptionSurface, isMeteredSurface, evalUser, evalUserExists } = require('./provider');
const { isolationPreflight } = require('./firstrun');
const { stubEnabled } = require('./stub');
const { SAMPLING } = require('./sampling');
const { estimateTokens } = require('./skillCost');
const { buildDriftReport, revisionPairProblem } = require('./diff');
const { caseRubricHash } = require('./judge');
const { canonicalModelId } = require('./usage');
const { termText, mdText } = require('./names');
const { UNDERPOWERED_LINE, drawsLine } = require('./verdict');
const { RUNNER_VERSION, DEFAULT_JUDGE_SAMPLES, DEV_MAX_CALLS, DEV_MAX_USD, SKILL_MAX_BYTES } = require('../config');

const CAVEAT = 'These tasks, this judge, this day: a difference is detected under the rule, never proof; no clear difference is not proof the two are the same; the two runs were sequential, so time-of-day conditions were not identical.';
const SELF_GRADING = 'The judge is the same model that answered. A model grading its own answers may favour some kinds of answer.';
const fail = (message, exitCode = 2) => { throw Object.assign(new Error(message), { exitCode }); };
// Issue 758: each side named by how compare was invoked (spec 722 A-722-3). Compare is handed two
// paths and cannot see where A came from, so only a caller that built A from HEAD may say so.
const REMOVAL_NAMES = Object.freeze({ a: 'A (the whole file)', b: 'B (the file without the section)' });
const COMMITTED_NAMES = Object.freeze({ a: 'A (the committed version)', b: 'B (your working copy)' });
function checkAIs(aIs) {
  if (aIs !== undefined && aIs !== 'committed') fail('a-is: expected committed.');
}
function sideNames({ a, b, removal, aIs }, escape = String) {
  if (removal) return REMOVAL_NAMES;
  if (aIs === 'committed') return COMMITTED_NAMES;
  const kind = a.unit === 'skill' ? 'folder' : 'file';
  return { a: `A (${escape(a.name)}, the ${kind} given first)`, b: `B (${escape(b.name)}, the ${kind} given second)`, named: true };
}
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
function valid(receipt) {
  if (!verifyReceiptHash(receipt)) fail('receipt_hash does not verify; nothing read.');
  if (!validateReceipt(receipt).valid) fail('Receipt does not validate; nothing read.');
}

// Issue 730: offsets index the original buffer, never reconstructed lines.
function sectionText(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > SKILL_MAX_BYTES) fail('Expected file bytes within SKILL_MAX_BYTES.');
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch (_) { fail('The file is not UTF-8.'); }
  if (text.includes(String.fromCharCode(0))) fail('The file holds a NUL character.');
  return text;
}
// A heading's text without its closing hashes (A-730-2). One pass from the end: the closing run
// stands alone or follows a space or tab, and may be followed by spaces and tabs.
function headingText(text) {
  const blank = (c) => c === ' ' || c === '\t';
  let end = text.length;
  while (end > 0 && blank(text[end - 1])) end--;
  let run = end;
  while (run > 0 && text[run - 1] === '#') run--;
  return (run < end && (run === 0 || blank(text[run - 1])) ? text.slice(0, run) : text).trim();
}
function listSections(bytes) {
  sectionText(bytes);
  const headings = [];
  let fence = null, previous = null;
  for (let offset = 0; offset < bytes.length;) {
    let end = offset;
    while (end < bytes.length && bytes[end] !== 10 && bytes[end] !== 13) end++;
    const next = end + (bytes[end] === 13 && bytes[end + 1] === 10 ? 2 : end < bytes.length ? 1 : 0);
    const start = offset === 0 && bytes.subarray(0, 3).equals(Buffer.from([239, 187, 191])) ? 3 : offset;
    const line = bytes.subarray(start, end).toString('utf8');
    offset = next;
    if (fence) {
      const close = /^ {0,3}(\x60+|~+)[ \t]*$/.exec(line);
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) fence = null;
      previous = null; continue;
    }
    const open = /^ {0,3}(\x60{3,}|~{3,})(.*)$/.exec(line);
    if (open && (open[1][0] !== '\x60' || !open[2].includes('\x60'))) {
      fence = open[1]; previous = null; continue;
    }
    const atx = /^ {0,3}(#{1,6})(?:[ \t]+(.*)|[ \t]*)$/.exec(line);
    if (atx) {
      const heading = headingText(atx[2] || '');
      headings.push({ heading, level: atx[1].length, start }); previous = null; continue;
    }
    const underline = /^ {0,3}(=+|-+)[ \t]*$/.exec(line);
    if (underline && previous) {
      headings.push({ heading: previous.text.trim(), level: underline[1][0] === '=' ? 1 : 2, start: previous.start });
      previous = null; continue;
    }
    // A single plain source line can be a setext heading. Indented code and
    // container markers do not turn into top-level sections.
    previous = line.trim() && !/^(?: {4}|\t| {0,3}(?:>|[-+*][ \t]|\d+[.)][ \t]))/.test(line)
      ? { text: line, start } : null;
  }
  const stack = [];
  for (const row of headings) {
    while (stack.length && stack[stack.length - 1].level >= row.level) stack.pop().end = row.start;
    stack.push(row);
  }
  for (const row of stack) row.end = bytes.length;
  return headings.map((row) => ({ ...row, bytes: row.end - row.start,
    tokens: estimateTokens(bytes.subarray(row.start, row.end).toString('utf8')) }));
}
function removeSection(bytes, heading) {
  string(heading, '--without-section');
  const sections = listSections(bytes);
  if (!sections.length) fail('The file has no headings to remove.');
  const matches = sections.filter((section) => section.heading === heading);
  if (matches.length !== 1) fail(heading + ': matches ' + matches.length + ' sections; expected exactly one heading.');
  const section = matches[0];
  const reduced = Buffer.concat([bytes.subarray(0, section.start), bytes.subarray(section.end)]);
  if (!/(?!\p{Default_Ignorable_Code_Point})[\p{L}\p{N}]/u.test(reduced.toString('utf8'))) fail('The reduced file holds no letter or digit, so it would measure nothing.');
  return { bytes: reduced, section };
}
const removalCaseReading = (row) => compareCaseReading(row, REMOVAL_NAMES);
const REMOVAL_CAVEAT = 'On these tasks, this judge, this day. No clear difference is not proof the section does nothing. A shorter file is also a shorter file, so length moved too. Sections can matter together in ways one removal cannot see.';
function sectionFileName(aName, heading) {
  const stem = path.basename(aName, path.extname(aName));
  return stem + '.without-' + (fileSlug(heading).slice(0, 64) || 'section') + '.md';
}
function listFileSections(file) {
  if (!/\.(md|markdown)$/i.test(file)) fail('Expected one Markdown file for --list-sections.');
  const bytes = readRequired(file, path.basename(file), SKILL_MAX_BYTES, 'SKILL_MAX_BYTES');
  const sections = listSections(bytes);
  if (!sections.length) fail('The file has no headings to remove.');
  for (const section of sections) console.log('level ' + section.level + ': ' + termText(section.heading) + '; ' + section.bytes + ' bytes; ' + section.tokens + ' estimated tokens');
  return { sections };
}

function subjectPair(a, b) {
  if (a.unit !== b.unit) fail('The two subjects have different kinds; give two files or two skill directories.');
  if (a.contentHash === b.contentHash) fail('The subjects have the same content hash; nothing to compare.');
  if (a.suite.suiteHash !== b.suite.suiteHash) fail('The suite hashes differ; use the same tasks and grading guide.');
  if (!isDeepStrictEqual(a.suite.cases, b.suite.cases)) fail('The tasks or checks differ despite matching core suite hashes; use the same suite.');
  if (!a.suite.caseCount || !b.suite.caseCount) fail('The suite has no tasks; nothing to compare.');
}
const JUDGE_KEYS = ['model_id', 'surface', 'samples', 'temperature', 'sampling', 'prompt_template_hash',
  'criteria_template_hash', 'harness', 'isolation', 'endpoint', 'code_revision', 'reported_models'];
function controls(r) {
  return { model: r.run.model_id, provider: r.run.provider, surface: r.run.surface,
    delivery: r.run.delivery, capture: r.run.capture, timeout: r.run.timeout_ms,
    harness: r.run.harness, isolation: r.run.answered_by?.isolation,
    sampled: r.generation_sampled, preset: r.run.preset,
    judge: Object.fromEntries(JUDGE_KEYS.map((k) => [k, r.run.judge[k]])),
    placebo: r.placebo ? { revision: r.placebo.revision, corpus: r.placebo.corpus_hash } : null,
    tasks: r.results.cases.map((c) => ({ id: c.id, mode: c.mode })) };
}
function compareCaseReading(row, names = { a: 'A', b: 'B' }) {
  if (row.verdict === 'regression') return `${names.b} scored clearly lower than ${names.a}`;
  if (row.verdict === 'improvement') return `${names.b} scored clearly higher than ${names.a}`;
  if (row.verdict === 'within noise' || row.verdict === 'within noise (below effect floor)') return row.power ? 'too few answers' : 'no clear difference';
  return ({ refused: 'refused', inconclusive: 'inconclusive', 'not measured': 'not measured', 'n/a': 'not measured' })[row.verdict] || 'not measured';
}
function taskPhrase(rows, escape) {
  const ids = rows.map((r) => escape(r.id));
  return ids.length === 1 ? `the ${ids[0]} task` : `the ${ids.slice(0, -1).join(', ')} and ${ids.at(-1)} tasks`;
}
// Issue 758: compare's closing line. revisionHeadline keeps its wording for `diff --mode revision`,
// where B really is the current upstream text. One line: a reader of the report's tail takes it alone.
// The rule compares each side's average with one spread either way, so "the scores do not overlap"
// would be false: one answer on each side can share a score while the rule still separates them.
function compareHeadline(perCase, names, escape = String) {
  const lower = perCase.filter((r) => r.verdict === 'regression');
  const higher = perCase.filter((r) => r.verdict === 'improvement');
  const rule = 'detected under the rule (the two averages differ by more than their usual spread), not proof of its cause.';
  if (lower.length && higher.length) return `${names.b} scored lower than ${names.a} on ${taskPhrase(lower, escape)} and higher on ${taskPhrase(higher, escape)}. Each is a separation ${rule}`;
  if (lower.length) return `${names.b} scored lower than ${names.a} on ${taskPhrase(lower, escape)}, and no other task separated. This is a separation ${rule}`;
  if (higher.length) return `${names.b} scored higher than ${names.a} on ${taskPhrase(higher, escape)}, and no other task separated. This is a separation ${rule}`;
  return `No separation was detected between ${names.a} and ${names.b} on any task at this sample size; this is not evidence that the two files behave alike.`;
}
// A-722-1: use only a ceiling whose rule has been read: the installed version's constant, or a
// released version's own, recorded here so a later release leaves a sealed reading as it was.
const RELEASED_CEILINGS = Object.freeze({ '0.27.0': 10 });
function ceilingOf(version) {
  if (version === RUNNER_VERSION) return SAMPLING.max;
  return Object.hasOwn(RELEASED_CEILINGS, version) ? RELEASED_CEILINGS[version] : null;
}
function ceiling(r) {
  const max = ceilingOf(r.run.runner_version);
  return max !== null
    ? `at most ${max} answers per task, for each way the task was run; the limit in Driftproof ${r.run.runner_version}, which this receipt records.`
    : `the answer limit of Driftproof ${r.run.runner_version} is unknown to this version, so no comparison is made.`;
}
function renderCompareReport(aReceipt, bReceipt, { a, b, withoutSection, aIs }) {
  valid(aReceipt); valid(bReceipt); subjectPair(a, b);
  checkAIs(aIs);
  for (const [s, r] of [[a, aReceipt], [b, bReceipt]]) {
    if (s.contentHash !== r.skill.content_hash || s.suite.suiteHash !== r.suite.suite_hash || s.unit !== r.skill.unit || estimateTokens(s.skillMd) !== r.skill.tokens) fail('Subject evidence differs from the sealed receipt.');
    if (s.unit === 'context_file' && hash(Buffer.from(s.skillMd)) !== s.contentHash) fail('Subject bytes differ from their hash.');
    if (!r.run.judge?.prompt_template_hash) fail('The judge template is missing.');
    // A failed arm has no grade or rubric hash. Its sealed suite still binds the
    // grading guide; compare any grades that exist against that same guide.
    for (const row of r.results.cases) {
      const task = s.suite.cases.find((c) => c.id === row.id);
      if (!task || (row.judge && row.judge.rubric_hash !== caseRubricHash(task))) fail('The recorded task rubric differs from the suite.');
      if (!row.judge && !['failed_timeout', 'failed_unmeasured'].includes(row.case_status)) fail('The task has no recorded grading guide.');
    }
  }
  const problem = revisionPairProblem(aReceipt, bReceipt);
  if (problem) fail(`Comparison refused: ${problem}.`);
  const ca = controls(aReceipt), cb = controls(bReceipt);
  for (const key of Object.keys(ca)) if (!isDeepStrictEqual(ca[key], cb[key])) fail(`Effective ${key} settings differ; no comparison reading.`);
  let removal = null;
  if (withoutSection !== undefined) {
    if (a.unit !== 'context_file' || b.unit !== 'context_file') fail('Section removal requires two context files.');
    removal = removeSection(Buffer.from(a.skillMd), withoutSection);
    if (!removal.bytes.equals(Buffer.from(b.skillMd))) fail('B is not the exact named section removal from A.');
  }
  const versionsDiffer = aReceipt.run.runner_version !== bReceipt.run.runner_version;
  const unknownCeiling = [aReceipt, bReceipt].some((r) => ceilingOf(r.run.runner_version) === null);
  const report = buildDriftReport(aReceipt, bReceipt, { mode: 'revision' });
  const selfGraded = canonicalModelId(aReceipt.run.judge.model_id) === canonicalModelId(aReceipt.run.model_id);
  const render = (escape) => {
    const side = sideNames({ a, b, removal, aIs }, escape);
    const lines = ['Compare two versions on these tasks', ''];
    for (const [label, s, r] of [[side.a, a, aReceipt], [side.b, b, bReceipt]]) {
      // Names that already carry the file's name do not repeat it; the fixed roles still show it.
      lines.push(`${label}: ${side.named ? '' : escape(s.name) + '; '}${Buffer.byteLength(s.skillMd)} bytes; ${estimateTokens(s.skillMd)} estimated tokens; ${s.unit === 'skill' ? 'subject directory ' : ''}sha256 ${s.contentHash}`);
      if (s.unit === 'skill') lines.push(`${label}: length and tokens describe SKILL.md; the subject hash includes bundled files.`);
      lines.push(`${label}: ${escape(ceiling(r))}`);
      lines.push(`${label}: receipt ${r.receipt_hash}; run date ${escape(r.run.date_utc)}`);
      if (r.run.status === 'incomplete') lines.push(`${label} is incomplete: an arm has no measured answers, so no comparison is made.`);
    }
    if (versionsDiffer) lines.push('Runner versions differ; their sampling rules are not established as the same. No measured comparison is made.');
    else if (unknownCeiling) lines.push('The answer limit is unknown for this version of Driftproof. No measured comparison is made.');
    const stub = [aReceipt, bReceipt].some((r) => r.run.surface === 'stub' || r.run.judge.surface === 'stub');
    if (stub) lines.push('Stub comparison: no model was called; these receipts are UNVERIFIED and measure nothing.');
    lines.push(`Model: ${escape(aReceipt.run.model_id)}; judge: ${escape(aReceipt.run.judge.model_id)}; ${aReceipt.run.judge.samples} judge samples per answer.${selfGraded ? ' ' + SELF_GRADING : ''}`, '');
    const removalPrefix = removal ? "Removing '" + escape(removal.section.heading) + "' (" + removal.section.bytes + ' bytes, about ' + removal.section.tokens + ' tokens, ' + (100 * removal.section.bytes / Buffer.byteLength(a.skillMd)).toFixed(1) + '% of the file): ' : '';
    if (removal) {
      lines.push('Reduced file: ' + escape(b.name) + '; sha256 ' + b.contentHash);
      lines.push(REMOVAL_CAVEAT, '');
    }
    for (const row of report.perCase) {
      if (removal) lines.push(removalPrefix + (unknownCeiling || versionsDiffer || stub ? 'not measured' : removalCaseReading(row)) + ' on task ' + escape(row.id));
      else lines.push(`- ${escape(row.id)}: ${unknownCeiling || versionsDiffer ? 'not measured' : compareCaseReading(row, side)}`);
      if (row.power && !unknownCeiling && !versionsDiffer) {
        lines.push(escape(UNDERPOWERED_LINE + '. ' + drawsLine({ value: row.power.drawsNeeded, reason: row.power.reason, case: row.id, spread: row.power.spread })));
      }
      if (row.lost) for (const [label, lost] of [[side.a, row.lost.a], [side.b, row.lost.b]]) if (lost) {
        lines.push(`${label} lost ${lost.lost} of ${lost.drawn} answers: ${escape(lost.reasons.join('; '))}.`);
      }
    }
    const suppressed = versionsDiffer || unknownCeiling || stub || report.perCase.some((r) => ['not measured', 'refused', 'n/a'].includes(r.verdict));
    if (suppressed) lines.push('Not measured: the receipts do not support a revision verdict.');
    else if (report.perCase.some((r) => r.verdict === 'inconclusive') && !report.perCase.some((r) => ['regression', 'improvement'].includes(r.verdict))) {
      lines.push('Inconclusive: the observed separation is not shown to hold for every score of the lost answers.');
    } else lines.push(compareHeadline(report.perCase, side, escape));
    lines.push('', CAVEAT, '');
    return lines.join('\n');
  };
  return { terminal: render(termText), markdown: render(mdText) };
}
function number(value, fallback, label, { zero = false, decimal = false } = {}) {
  if (value === undefined || value === null) return fallback;
  const pattern = decimal ? /^(0|[1-9][0-9]*)(\.[0-9]+)?$/ : /^[1-9][0-9]*$/;
  const n = Number(value);
  if (typeof value === 'boolean' || !pattern.test(String(value)) || !Number.isFinite(n) || (!decimal && !Number.isSafeInteger(n)) || (zero ? n < 0 : n <= 0)) fail(`${label}: expected a ${zero ? 'non-negative' : 'positive'} ${decimal ? 'number' : 'integer'}.`);
  return n;
}
function string(value, label) {
  if (typeof value !== 'string' || !value) fail(`${label} requires a value.`);
  return value;
}
function readDefaults() {
  const file = path.join(process.cwd(), '.driftproofrc');
  if (!fs.existsSync(file)) return {};
  const rc = JSON.parse(readRequired(file, '.driftproofrc', SKILL_MAX_BYTES, 'SKILL_MAX_BYTES').toString('utf8'));
  if (!rc || typeof rc !== 'object' || Array.isArray(rc)) fail('.driftproofrc: expected an object.');
  return rc;
}
// Where a results folder would really be: the real path of its nearest existing
// ancestor, with the folders not made yet joined on (issue 756, A-722-5).
function realOutPath(out, { paths = path, real = fs.realpathSync, lstat = fs.lstatSync } = {}) {
  const missing = [];
  for (let at = out; ; at = paths.dirname(at)) {
    try { return paths.join(real(at), ...missing); }
    catch (e) { if (!['ENOENT', 'ENOTDIR', 'ELOOP'].includes(e.code)) throw e; }
    let dangling = false;
    try { dangling = lstat(at).isSymbolicLink(); } catch { /* Not made yet. */ }
    if (dangling) fail('--out goes through a link that points nowhere; choose another directory.');
    // A root that cannot be resolved, such as a missing Windows drive, is its own parent (A-722-6).
    if (paths.dirname(at) === at) return paths.join(at, ...missing);
    missing.unshift(paths.basename(at));
  }
}
async function compareSubjects(options) {
  const aPath = string(options.a, 'A');
  const removing = options.withoutSection !== undefined;
  if (options.listSections !== undefined && typeof options.listSections !== 'boolean') fail('--list-sections takes no value.');
  if ((removing || options.listSections) && options.b !== undefined) fail('Expected one file for section options, not two subjects.');
  if (removing && options.listSections) fail('Choose either --list-sections or --without-section, not both together.');
  checkAIs(options.aIs);
  if (options.aIs !== undefined && (removing || options.listSections)) fail('a-is names two given files; it cannot be used with a section option.');
  if (options.listSections) return listFileSections(aPath);
  const withoutSection = removing ? string(options.withoutSection, '--without-section') : undefined;
  const bPath = removing ? null : string(options.b, 'B');
  const rc = readDefaults();
  const suite = options.suite === undefined ? undefined : string(options.suite, '--suite');
  const out = path.resolve(options.out === undefined ? 'receipts' : string(options.out, '--out'));
  const reading = path.join(out, 'compare.md');
  if (fs.existsSync(reading)) fail('compare.md already exists; choose another --out directory.');
  const given = options.models ?? rc.models ?? 'haiku';
  const names = Array.isArray(given) ? given : string(given, '--models').split(',').map((m) => m.trim());
  if (!names.length || names.some((m) => typeof m !== 'string' || !m)) fail('--models: expected registered model names.');
  const models = [...new Set(names.map((m) => assertRegistered(m)))];
  const judgeGiven = options.judgeModel ?? rc.judge_model;
  const judge = judgeGiven === undefined ? null : assertRegistered(string(judgeGiven, 'judge_model'), 'judge model');
  const samples = number(options.samples ?? rc.samples, DEFAULT_JUDGE_SAMPLES, '--samples');
  const maxCalls = number(options.maxCalls ?? rc.max_calls, DEV_MAX_CALLS, '--max-calls');
  const maxUsd = number(options.maxUsd ?? rc.max_usd, DEV_MAX_USD, '--max-usd', { zero: true, decimal: true });
  const concurrency = number(rc.concurrency, 1, 'concurrency');
  const capture = rc.capture ?? 'text';
  if (!['text', 'files'].includes(capture)) fail('compare capture: expected text or files in .driftproofrc.');
  if (options.placebo !== undefined && typeof options.placebo !== 'boolean') fail('placebo: expected a boolean.');
  const placebo = options.placebo === true;
  // A-722-4: only the flag sets the lane, and one value reaches both versions.
  if (options.trusted !== undefined && typeof options.trusted !== 'boolean') fail('trusted: expected a boolean.');
  const trusted = options.trusted === true;
  const stub = stubEnabled();
  const surfaces = [...new Set(models.flatMap((m) => [surfaceForModel(m), surfaceForModel(judge || m)]))];
  const isolated = surfaces.filter(isSubscriptionSurface);
  if (!trusted && !stub && isolated.length) {
    const user = evalUser();
    const problem = isolationPreflight({ surfaces: isolated, trusted, stub, user, exists: evalUserExists(user) });
    if (problem) fail(problem);
  }
  if (!stub && capture === 'files' && models.some((m) => isMeteredSurface(surfaceForModel(m)))) fail('capture files requires a CLI surface; nothing run.');
  const a = loadSubject(aPath, { suite });
  let b, reduced;
  if (removing) {
    if (a.unit !== 'context_file') fail('--without-section requires one Markdown file.');
    reduced = removeSection(Buffer.from(a.skillMd), withoutSection);
    const name = sectionFileName(a.name, withoutSection);
    const file = path.join(out, name);
    // lstat catches a dangling symlink too, before any calls or output files.
    try { fs.lstatSync(file); fail('The reduced file already exists; choose another --out directory.'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    const text = reduced.bytes.toString('utf8');
    b = { ...a, dir: out, file, name, skillMd: text, contentHash: hash(reduced.bytes), version: parseSkillMeta(text).version || '0.0.0' };
  } else b = loadSubject(bPath, { suite });
  subjectPair(a, b);
  for (const s of [a, b]) {
    if (s.suite.executionFreeze) fail('Execution suites require repository capture; use run for this suite.');
    if (s.unit === 'skill') {
      // Do not place results in the subject whose directory hash they would change.
      const relative = path.relative(fs.realpathSync(s.dir), realOutPath(out));
      if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) fail('--out must be outside both skill directories.');
    }
    for (const m of models) assertSubjectFits({ skill: s, cases: s.suite.cases, modelId: m, trusted, capture });
    if (placebo) {
      const p = require('./placebo');
      const built = p.placeboFor({ skillText: s.skillMd, seed: s.contentHash });
      p.assertPlaceboLength(s.skillMd, built);
      if (p.sharedRun(s.skillMd, built.text)) fail('The placebo shares a six-word run with the subject; nothing run.');
    }
  }
  const arms = placebo ? 3 : 2;
  const perRunCalls = projectCalls(a.suite.caseCount, samples, SAMPLING.max, arms);
  const totalCalls = perRunCalls * models.length * 2;
  const plans = models.map((model) => ({ model, judge: judge || model,
    // One explicit timeout for generation and grading, sealed by the ordinary runner.
    timeoutMs: Math.max(resolveCallTimeoutMs(surfaceForModel(model), { capture }), resolveCallTimeoutMs(surfaceForModel(judge || model), { capture })) }));
  const costs = plans.map((p) => estimateRunCostUSD({ caseCount: a.suite.caseCount, samples, models: [p.model], judgeModel: p.judge, draws: SAMPLING.max, arms }));
  const totalUSD = costs.reduce((sum, c) => sum + c.totalUSD * 2, 0);
  console.log(`${stub ? 'Stub plan: projected synthetic calls' : 'Projected calls'}: ${totalCalls} for both versions across ${models.length} model(s), at most.`);
  console.log(stub ? 'No projected cost: no model will be called.' : `Estimated cost for both versions: ~$${totalUSD.toFixed(4)} (rough API equivalent; subscription calls have no metered API charge).`);
  if (totalCalls > maxCalls) fail(`--max-calls ${maxCalls} is below the ${totalCalls} ${stub ? 'synthetic ' : ''}calls planned for the whole comparison; nothing run.`, 3);
  if (totalUSD > maxUsd) fail(stub ? `Stub plan exceeds --max-usd ${maxUsd}: ${totalCalls} synthetic calls planned; no model will be called.` : `Estimated cost ~$${totalUSD.toFixed(4)} exceeds --max-usd ${maxUsd}; nothing run.`, 3);
  const budget = new BudgetTracker(maxUsd);
  fs.mkdirSync(out, { recursive: true });
  if (removing) {
    fs.writeFileSync(b.file, reduced.bytes, { flag: 'wx' });
    console.log('Reduced file: ' + termText(b.name) + '; sha256 ' + b.contentHash);
  }
  if (trusted && isolated.length) console.log('  isolation: same-user (--trusted-skill: self-authored skill)');
  const results = [], readings = [];
  for (const p of plans) {
    const opts = { samples, judgeModel: p.judge, maxCalls: perRunCalls, concurrency, capture,
      timeoutMs: p.timeoutMs, placebo, trusted, budget };
    const pair = [];
    for (const [label, skill] of [['A', a], ['B', b]]) {
      const result = await runSkillOnModel({ skill, model: p.model, opts: { ...opts } });
      valid(result.receipt);
      const receipt = result.receipt;
      if (receipt.run.model_id !== p.model || receipt.run.judge.model_id !== p.judge ||
          receipt.run.judge.samples !== samples || receipt.run.capture.mode !== capture ||
          receipt.run.timeout_ms !== p.timeoutMs || receipt.run.runner_version !== RUNNER_VERSION ||
          !!receipt.placebo !== placebo || receipt.skill.content_hash !== skill.contentHash ||
          receipt.suite.suite_hash !== skill.suite.suiteHash) fail('The receipt differs from the requested effective settings.');
      const file = path.join(out, `compare-${label}-${result.receipt.receipt_hash}.json`);
      fs.writeFileSync(file, JSON.stringify(result.receipt, null, 2) + '\n', { flag: 'wx' });
      pair.push(result.receipt); results.push({ file, receipt: result.receipt });
    }
    readings.push(renderCompareReport(pair[0], pair[1], { a, b, withoutSection, aIs: options.aIs }));
  }
  const markdown = readings.map((r) => r.markdown).join('\n');
  fs.writeFileSync(reading, markdown, { flag: 'wx' });
  console.log(readings.map((r) => r.terminal).join('\n'));
  return { receipts: results, reading, markdown };
}

module.exports = { compareSubjects, renderCompareReport, compareCaseReading, compareHeadline, sideNames, ceilingOf, listSections, removeSection, removalCaseReading, realOutPath };
