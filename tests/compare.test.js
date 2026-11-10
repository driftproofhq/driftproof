// SPDX-License-Identifier: Apache-2.0
'use strict';
process.env.DRIFTPROOF_STUB = '1';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { loadSubject } = require('../lib/skill');
const { validateReceipt, verifyReceiptHash, sealReceipt } = require('../lib/receipt');
const { resolveCount } = require('../lib/counts');
const { projectCalls } = require('../lib/run');
const { estimateRunCostUSD } = require('../lib/cost');
const { estimateTokens } = require('../lib/skillCost');
const { buildDriftReport } = require('../lib/diff');
const { termText, mdText } = require('../lib/names');
const { GENERATION_SAMPLES_MAX } = require('../config');
const ROOT = path.resolve(__dirname, '..');
const MODEL = 'claude-haiku-4-5';
const CAVEAT = 'These tasks, this judge, this day: a difference is detected under the rule, never proof; no clear difference is not proof the two are the same; the two runs were sequential, so time-of-day conditions were not identical.';
// Issue 758: the test's own copy of the words a reading is allowed.
const SELF_GRADING = 'The judge is the same model that answered. A model grading its own answers may favour some kinds of answer.';
// Specs 744 and 746 read this sentence, on the line before the closing caveat.
const NOT_MEASURED_LINE = 'Not measured: the receipts do not support a revision verdict.';
const given = (a, b, kind) => ({ a: 'A (' + a + ', the ' + kind + ' given first)', b: 'B (' + b + ', the ' + kind + ' given second)' });
const NAMES = {
  files: given('before.md', 'after.md', 'file'),
  folders: given('before', 'after', 'folder'),
  committed: { a: 'A (the committed version)', b: 'B (your working copy)' },
  removal: { a: 'A (the whole file)', b: 'B (the file without the section)' },
};
const scratch = [];
const clone = (x) => structuredClone(x);
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const feature = () => require('../lib/compare');
function fixture({ directories = false, hostile = false } = {}) {
  const dir = fs.mkdtempSync('/var/tmp/spec722-'); scratch.push(dir);
  const suite = path.join(dir, 'tasks.json');
  const cases = { cases: [{ id: 'task-one', prompt: 'Say hello.', rubric: 'A short greeting scores 0.8.' }] };
  fs.writeFileSync(suite, JSON.stringify(cases));
  const names = hostile ? ['before' + String.fromCharCode(27) + '[31m`$(touch sentinel).md', 'after|[name].md'] : ['before.md', 'after.md'];
  const texts = ['Give a short answer.\n', 'Give a short, friendly answer.\n'];
  const subjects = names.map((name, i) => {
    const file = path.join(dir, directories ? ['before', 'after'][i] : name);
    if (directories) {
      fs.mkdirSync(path.join(file, 'evals'), { recursive: true });
      fs.writeFileSync(path.join(file, 'SKILL.md'), texts[i]);
      fs.writeFileSync(path.join(file, 'evals/evals.json'), JSON.stringify(cases));
    } else fs.writeFileSync(file, texts[i]);
    return file;
  });
  return { dir, suite, subjects, texts, directories, out: path.join(dir, 'out') };
}
test.after(() => { for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true }); });
function env(extra = {}) {
  const out = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/API_KEY|TOKEN|SECRET|^CLAUDE_|^ANTHROPIC_|^OPENAI_|^DRIFTPROOF_|^SPEC722_|^NODE_OPTIONS$|^SOURCE_DATE_EPOCH$/.test(key)) continue;
    out[key] = value;
  }
  return { ...out, DRIFTPROOF_STUB: '1', ...extra };
}
function invoke(f, extra = [], plant = '') {
  const log = path.join(f.dir, 'events-' + crypto.randomBytes(4).toString('hex') + '.jsonl');
  const r = spawnSync(process.execPath, ['--require', path.join(ROOT, 'specs/722-compare/probe.cjs'),
    path.join(ROOT, 'bin/driftproof'), 'compare', ...f.subjects,
    ...(!f.directories ? ['--suite', f.suite] : []), '--models', MODEL, '--samples', '2', '--out', f.out, ...extra], {
    cwd: f.dir, env: env({ SPEC722_EVENTS: log, SPEC722_PLANT: plant }), encoding: 'utf8', timeout: 1800000,
  });
  assert.ifError(r.error);
  const events = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  return { ...r, events, text: (r.stdout || '') + (r.stderr || '') };
}
function receipts(f) {
  assert.ok(fs.existsSync(f.out), 'receipt output exists');
  return fs.readdirSync(f.out).filter((name) => name.endsWith('.json')).map((name) => {
    const receipt = JSON.parse(fs.readFileSync(path.join(f.out, name), 'utf8'));
    assert.equal(validateReceipt(receipt).valid, true, 'ordinary receipt validates');
    assert.equal(verifyReceiptHash(receipt), true, 'ordinary receipt hash verifies');
    return receipt;
  });
}
function pair(f, list) {
  const loaded = f.subjects.map((file) => loadSubject(file, f.directories ? {} : { suite: f.suite }));
  const ordered = loaded.map((s) => list.find((r) => r.skill.content_hash === s.contentHash));
  assert.ok(ordered.every(Boolean), 'both original subject hashes are sealed');
  return { loaded, ordered };
}
function refusal(f, r, reason, status = 2) {
  assert.equal(r.status, status, r.text);
  assert.match(r.text, reason, 'refusal names its actual reason');
  assert.doesNotMatch(r.text, /Unknown command/i, 'a missing command is not a refusal test pass');
  assert.equal(r.events.filter((x) => x.event === 'call').length, 0, 'refusal precedes any call');
  assert.equal(fs.existsSync(path.join(f.out, 'compare.md')), false, 'no success reading');
  assert.equal(fs.existsSync(f.out) ? fs.readdirSync(f.out).length : 0, 0, 'no emitted files');
}
const JUDGE_KEYS = ['model_id', 'surface', 'samples', 'temperature', 'sampling', 'prompt_template_hash',
  'criteria_template_hash', 'harness', 'isolation', 'endpoint', 'code_revision'];
function settings(r) {
  return { model: r.run.model_id, provider: r.run.provider, surface: r.run.surface,
    delivery: r.run.delivery, version: r.run.runner_version, capture: r.run.capture,
    timeout: r.run.timeout_ms, placebo: !!r.placebo,
    judge: Object.fromEntries(JUDGE_KEYS.map((k) => [k, r.run.judge[k]])),
    sampled: r.generation_sampled,
    cases: r.results.cases.map((c) => ({ id: c.id, mode: c.mode, rubric: c.judge?.rubric_hash })) };
}
function countOracle(receipt, calls) {
  let generations = 0, judges = 0;
  receipt.results.cases.forEach((row, i) => {
    const draws = row.generation.draws;
    assert.equal(resolveCount(receipt, i, 'generations_per_arm'), draws.length);
    generations += draws.length;
    for (const draw of draws) {
      // These stub fixtures have neither retries nor failed generations.
      assert.equal(draw.samples.length, resolveCount(receipt, i, 'judge_samples_per_generation'));
      judges += draw.samples.length;
    }
  });
  assert.equal(calls.filter((c) => !c.judge).length, generations, 'observed generation count');
  assert.equal(calls.filter((c) => c.judge).length, judges, 'observed judge count');
}
function expectedCase(row, names = { a: 'A', b: 'B' }) {
  if (row.verdict === 'regression') return names.b + ' scored clearly lower than ' + names.a;
  if (row.verdict === 'improvement') return names.b + ' scored clearly higher than ' + names.a;
  if (row.power) return 'too few answers';
  if (['within noise', 'within noise (below effect floor)'].includes(row.verdict)) return 'no clear difference';
  return ({ 'not measured': 'not measured', refused: 'refused', inconclusive: 'inconclusive', 'n/a': 'not measured' })[row.verdict];
}
function readingOracle(text, loaded, ordered, markdown) {
  assert.ok(text.includes(CAVEAT), 'fixed caveat');
  assert.doesNotMatch(text, /upstream/i, 'B is never named upstream');
  assert.doesNotMatch(text, /REVISION (?:IMPROVED|REGRESSED)|MIXED:|NO SEPARATION DETECTED/, 'no revision-drift label');
  assert.doesNotMatch(text, /SAMPLING\.max|run\.runner_version|Draws ceiling/, 'no code identifier in the ceiling line');
  assert.doesNotMatch(text, /the committed file|your edit/, 'no side named for what compare cannot see');
  assert.doesNotMatch(text, /score ranges|scores? do not overlap/, 'the rule compares averages, not ranges');
  if (ordered[0].run.judge.model_id === ordered[0].run.model_id) assert.ok(text.includes(SELF_GRADING), 'self-grading caveat');
  else assert.ok(!text.includes(SELF_GRADING), 'self-grading caveat only when the judge is the model');
  const kind = loaded[0].unit === 'skill' ? 'folder' : 'file';
  const shown = (s) => (markdown ? mdText(s.name) : termText(s.name));
  assert.ok(text.includes('A (' + shown(loaded[0]) + ', the ' + kind + ' given first)'), 'A named as given');
  assert.ok(text.includes('B (' + shown(loaded[1]) + ', the ' + kind + ' given second)'), 'B named as given');
  loaded.forEach((s, i) => {
    const lengthLine = text.split('\n').find((line) => line.includes(s.contentHash));
    assert.ok(lengthLine, 'full subject hash');
    assert.match(lengthLine, new RegExp('\\b' + Buffer.byteLength(s.skillMd) + '\\s+bytes\\b'), 'byte length beside hash');
    assert.match(lengthLine, new RegExp('\\b' + estimateTokens(s.skillMd) + '\\s+estimated tokens\\b'), 'token estimate beside hash');
    const escaped = markdown ? mdText(s.name) : termText(s.name);
    assert.ok(text.includes(escaped), 'escaped subject name');
    assert.equal(ordered[i].skill.tokens, estimateTokens(s.skillMd));
  });
  assert.ok(!text.includes(String.fromCharCode(27)), 'no raw terminal escape');
  for (const row of buildDriftReport(...ordered, { mode: 'revision' }).perCase) {
    const line = text.split('\n').find((s) => s.includes(row.id) && s.includes(expectedCase(row)));
    assert.ok(line, 'per-task reading agrees with differ for ' + row.id);
  }
  if (ordered.some((r) => r.verification_level !== 'TESTED')) {
    assert.match(text, /no model (?:was|will be) called/i);
    assert.doesNotMatch(text, /REVISION (?:IMPROVED|REGRESSED)|scored clearly (?:higher|lower)/);
  }
}
// The headline's own oracle (issue 758): built from the rows, never from the code under test.
function headlineOracle(line, rows, names) {
  const ids = (verdict) => rows.filter((r) => r.verdict === verdict).map((r) => r.id);
  const lower = ids('regression'), higher = ids('improvement');
  const on = (list) => (list.length === 1 ? 'the ' + list[0] + ' task' : 'the ' + list.slice(0, -1).join(', ') + ' and ' + list.at(-1) + ' tasks');
  assert.equal(line.split('\n').length, 1, 'one line');
  assert.doesNotMatch(line, /upstream|pinned|REVISION|MIXED|DRIFT/i, 'no revision-drift word');
  assert.doesNotMatch(line, /\b(?:worse|better|caused|because)\b/i, 'no verdict word or cause');
  assert.ok(line.includes(names.a) && line.includes(names.b), 'names A and B');
  if (!lower.length && !higher.length) {
    assert.match(line, /^No separation was detected between /, 'no separation');
    assert.ok(line.includes('this is not evidence that the two files behave alike'), 'not sameness');
    return;
  }
  assert.ok(line.startsWith(names.b + ' scored '), 'B is the subject');
  if (lower.length) assert.ok(line.includes('lower than ' + names.a + ' on ' + on(lower)), 'the lower tasks');
  if (higher.length) assert.ok(line.includes((lower.length ? 'and higher on ' : 'higher than ' + names.a + ' on ') + on(higher)), 'the higher tasks');
  if (!higher.length || !lower.length) assert.ok(line.includes(', and no other task separated.'), 'no other task');
  assert.ok(line.includes('detected under the rule (the two averages differ by more than their usual spread), not proof of its cause'), 'under the rule, not a cause');
  assert.doesNotMatch(line, /score ranges|scores? do not overlap/, 'the rule compares averages, not ranges');
}
let accepted;
function success() {
  if (accepted) return accepted;
  const f = fixture({ hostile: true }); const r = invoke(f);
  assert.equal(r.status, 0, r.text);
  const list = receipts(f); assert.equal(list.length, 2);
  const p = pair(f, list);
  accepted = { f, r, ...p, markdown: fs.readFileSync(path.join(f.out, 'compare.md'), 'utf8') };
  return accepted;
}

test('AC-1/3/9: two file revisions produce two ordinary sealed stub receipts', () => {
  const { ordered } = success();
  for (const r of ordered) { assert.equal(r.verification_level, 'UNVERIFIED'); assert.equal(r.run.surface, 'stub'); }
});
test('AC-2/4: A completes before B, effective controls and observed counts match', () => {
  const { r, ordered } = success();
  const starts = r.events.filter((e) => e.event === 'begin');
  assert.equal(starts.length, 2); assert.deepEqual(starts[0].settings, starts[1].settings);
  assert.deepEqual(settings(ordered[0]), settings(ordered[1]));
  assert.ok(r.events.findIndex((e) => e.event === 'end' && e.side === 1) < r.events.findIndex((e) => e.event === 'begin' && e.side === 2));
  ordered.forEach((receipt, i) => {
    const calls = r.events.filter((e) => e.event === 'call' && e.side === i + 1);
    countOracle(receipt, calls);
    for (const judge of [false, true]) assert.throws(() => countOracle(receipt, [...calls, { judge }]), /observed/);
  });
  const moved = clone(ordered[1]); moved.run.judge.samples += 1;
  assert.notDeepEqual(settings(ordered[0]), settings(moved), 'settings plant is visible');
});
test('AC-5/6/7: both readings match the differ and disclose length, timing and safe names', () => {
  const { f, r, loaded, ordered, markdown } = success();
  readingOracle(r.stdout, loaded, ordered, false); readingOracle(markdown, loaded, ordered, true);
  assert.equal(fs.existsSync(path.join(f.dir, 'sentinel')), false);
  for (const [label, changed] of [
    ['missing caveat', markdown.replace(CAVEAT, '')],
    ['missing length', markdown.split('\n').filter((s) => !s.includes(loaded[0].contentHash)).join('\n')],
    ['wrong tokens', markdown.replace(/\d+ estimated tokens/, '999999 estimated tokens')],
    ['wrong per-task reading', markdown.split('\n').map((s) => s.includes('task-one') ? s.replace(/not measured/gi, 'A scored clearly higher') : s).join('\n')],
    ['raw name', markdown + String.fromCharCode(27)],
    ['B named upstream', markdown + '\nB is lower under the current upstream text.'],
    ['a revision label', markdown + '\nREVISION REGRESSED: separation detected.'],
    ['a code identifier', markdown + '\nA: Draws ceiling: 10, from SAMPLING.max.'],
    ['no self-grading caveat', markdown.replace(SELF_GRADING, '')],
    ['A named for what compare cannot see', markdown + '\nA (the committed file)'],
    ['the rule worded as score ranges', markdown + '\nThe two score ranges do not overlap.'],
    ['A not named as given', markdown.replaceAll('the file given first', 'the first one')],
    ['B not named as given', markdown.replaceAll('the file given second', 'the second one')],
  ]) assert.throws(() => readingOracle(changed, loaded, ordered, true), undefined, label);
  // The Action takes the line before the closing caveat, and two other specs read this sentence.
  const lines = markdown.split('\n');
  assert.equal(lines[lines.indexOf(CAVEAT) - 2], NOT_MEASURED_LINE);
});
test('A-722-3: compare\'s own headline says on which tasks B scored lower or higher than A', () => {
  const { compareHeadline } = feature();
  const tables = [
    [{ id: 'report', verdict: 'regression' }, { id: 'adr', verdict: 'within noise', power: {} }],
    [{ id: 'report', verdict: 'improvement' }],
    [{ id: 'report', verdict: 'regression' }, { id: 'adr', verdict: 'regression' }, { id: 'plan', verdict: 'regression' }],
    [{ id: 'one', verdict: 'regression' }, { id: 'two', verdict: 'improvement' }],
    [{ id: 'one', verdict: 'within noise' }, { id: 'two', verdict: 'within noise (below effect floor)', power: {} }],
    [{ id: 'report', verdict: 'regression' }, { id: 'adr', verdict: 'inconclusive' }],
  ];
  for (const names of Object.values(NAMES)) for (const rows of tables) {
    const line = compareHeadline(rows, names);
    headlineOracle(line, rows, names);
    assert.throws(() => headlineOracle(line + ' under the current upstream text', rows, names), /revision-drift/, 'naming B upstream reads red');
    assert.throws(() => headlineOracle(line.replace(names.a, 'A'), rows, names), undefined, 'A not named');
    assert.throws(() => headlineOracle(line + ' It is worse.', rows, names), /verdict word/);
    const separated = rows.some((r) => ['regression', 'improvement'].includes(r.verdict));
    if (separated) {
      assert.throws(() => headlineOracle(line.replace('the two averages differ by more than their usual spread', 'the two score ranges do not overlap'), rows, names), undefined, 'the false rule wording reads red');
      const swapped = line.includes('scored lower') ? line.replace('scored lower', 'scored higher') : line.replace('scored higher', 'scored lower');
      assert.throws(() => headlineOracle(swapped, rows, names), undefined, 'a swapped direction reads red');
      const id = rows.find((r) => r.verdict === 'regression' || r.verdict === 'improvement').id;
      assert.throws(() => headlineOracle(line.replace(id, 'another'), rows, names), undefined, 'a dropped task reads red');
    } else assert.throws(() => headlineOracle(line.replace('this is not evidence that the two files behave alike', 'the two files are the same'), rows, names), /not sameness/);
  }
  const hostile = [{ id: 'a|b*', verdict: 'regression' }];
  assert.ok(compareHeadline(hostile, NAMES.files, mdText).includes(mdText('a|b*')), 'task ids are escaped data');
  assert.ok(compareHeadline(hostile, NAMES.files, termText).includes(termText('a|b*')));
});
test('A-722-3: two folders are named as folders given in order', () => {
  const f = fixture({ directories: true }); const r = invoke(f);
  assert.equal(r.status, 0, r.text);
  const { loaded, ordered } = pair(f, receipts(f));
  for (const [text, markdown] of [[r.stdout, false], [fs.readFileSync(path.join(f.out, 'compare.md'), 'utf8'), true]]) readingOracle(text, loaded, ordered, markdown);
});
test('A-722-3: a caller that built A from HEAD can say so; nothing else is accepted', async () => {
  const f = fixture();
  const { markdown } = await feature().compareSubjects({ a: f.subjects[0], b: f.subjects[1], suite: f.suite, models: [MODEL], samples: 2, out: f.out, aIs: 'committed' });
  const loaded = f.subjects.map((file) => loadSubject(file, { suite: f.suite }));
  assert.ok(markdown.includes(NAMES.committed.a), 'A named committed'); assert.ok(markdown.includes(NAMES.committed.b), 'B named the working copy');
  assert.doesNotMatch(markdown, /given first|given second/, 'not the two-path names');
  for (const s of loaded) assert.ok(markdown.includes(s.contentHash) && markdown.includes(mdText(s.name)), 'each file keeps its name and hash');
  const bad = fixture();
  await assert.rejects(() => feature().compareSubjects({ a: bad.subjects[0], b: bad.subjects[1], suite: bad.suite, models: [MODEL], out: bad.out, aIs: 'upstream' }), /a-is/);
  assert.equal(fs.existsSync(bad.out), false, 'refused before any output');
  const both = sectionFixture();
  await assert.rejects(() => feature().compareSubjects({ a: both.subjects[0], withoutSection: 'Tone', suite: both.suite, models: [MODEL], out: both.out, aIs: 'committed' }), /a-is/);
  assert.equal(fs.existsSync(both.out), false, 'refused before any output');
});
test('A-722-1, A-722-3: a limit is known only for a version whose rule has been read', () => {
  const { ceilingOf } = feature();
  assert.equal(ceilingOf('0.27.0'), GENERATION_SAMPLES_MAX, 'the released version the sealed readings record');
  assert.equal(ceilingOf('0.0.1'), null, 'an unread version inherits nothing');
});
test('A-722-3: the self-grading caveat follows the sealed judge', () => {
  const f = fixture(); fs.writeFileSync(path.join(f.dir, '.driftproofrc'), JSON.stringify({ judge_model: 'claude-sonnet-5' }));
  const r = invoke(f); assert.equal(r.status, 0, r.text);
  const { loaded, ordered } = pair(f, receipts(f));
  assert.notEqual(ordered[0].run.judge.model_id, ordered[0].run.model_id, 'the plant really uses another judge');
  readingOracle(r.stdout, loaded, ordered, false);
  assert.throws(() => readingOracle(r.stdout + '\n' + SELF_GRADING, loaded, ordered, false), /only when the judge is the model/);
});
test('A-722-3: the exported renderer takes only the known role for A', () => {
  const { ordered, loaded } = success();
  assert.throws(() => feature().renderCompareReport(ordered[0], ordered[1], { a: loaded[0], b: loaded[1], aIs: 'upstream' }), /a-is/);
});
test('AC-5: direction, overlap, floor, power and suppressed cases use the existing verdict', () => {
  for (const row of [
    { verdict: 'regression' }, { verdict: 'improvement' }, { verdict: 'within noise' },
    { verdict: 'within noise (below effect floor)' }, { verdict: 'within noise', power: { state: 'underpowered' } },
    { verdict: 'inconclusive' }, { verdict: 'not measured' }, { verdict: 'refused' }, { verdict: 'n/a' },
  ]) {
    assert.equal(feature().compareCaseReading(row), expectedCase(row));
    assert.equal(feature().compareCaseReading(row, NAMES.removal), expectedCase(row, NAMES.removal), 'the same direction under the removal names');
  }
});
for (const [label, mutate, reason] of [
  ['equal content', (f) => fs.copyFileSync(f.subjects[0], f.subjects[1]), /same|identical|nothing to compare/i],
  ['invalid UTF-8', (f) => fs.writeFileSync(f.subjects[1], Buffer.from([0xff, 0xfe, 0x61])), /UTF-8/i],
  ['symbolic link', (f) => { fs.unlinkSync(f.subjects[1]); fs.symlinkSync(f.subjects[0], f.subjects[1]); }, /link/i],
  ['empty text', (f) => fs.writeFileSync(f.subjects[1], ' \n'), /letter|empty|nothing/i],
]) test('AC-1/7/9 refusal: ' + label, () => { const f = fixture(); mutate(f); refusal(f, invoke(f), reason); });
test('AC-9 refusal: unregistered model', () => {
  const f = fixture(); refusal(f, invoke(f, ['--models', 'not-a-registered-model']), /registered|registry/i);
});
test('AC-1: skill directories share a suite; a changed rubric refuses before calls', () => {
  const f = fixture({ directories: true }); const r = invoke(f);
  assert.equal(r.status, 0, r.text); assert.equal(receipts(f).length, 2);
  const bad = fixture({ directories: true });
  fs.writeFileSync(path.join(bad.subjects[1], 'evals/evals.json'), JSON.stringify({ cases: [{ id: 'task-one', prompt: 'Say hello.', rubric: 'Different rubric.' }] }));
  refusal(bad, invoke(bad), /suite/i);
});
for (const placebo of [false, true]) test('AC-8: whole-pair call and dollar caps, placebo=' + placebo, () => {
  const arms = placebo ? 3 : 2;
  const oneCalls = projectCalls(1, 2, GENERATION_SAMPLES_MAX, arms);
  const oneUSD = estimateRunCostUSD({ caseCount: 1, samples: 2, models: [MODEL], judgeModel: MODEL, draws: GENERATION_SAMPLES_MAX, arms }).totalUSD;
  for (const [flag, cap] of [['--max-calls', oneCalls], ['--max-usd', oneUSD]]) {
    const f = fixture(); const r = invoke(f, [flag, String(cap), ...(placebo ? ['--placebo'] : [])]);
    refusal(f, r, new RegExp(flag), 3);
    assert.ok(r.text.includes(String(oneCalls * 2)), 'names both-run projected calls');
    assert.doesNotMatch(r.text, /\$\d/, 'stub claims no dollar spend');
    const plant = { ...r, events: [...r.events, { event: 'call' }] };
    assert.throws(() => refusal(f, plant, new RegExp(flag), 3), /before|precedes/);
  }
});
test('AC-8: projection is visible before the first call', () => {
  const { r } = success(); const first = r.events.findIndex((e) => e.event === 'call');
  const before = r.events.slice(0, first).filter((e) => e.event === 'stdout').map((e) => e.text).join('');
  assert.match(before, /projected.*calls|calls.*projected/i);
  assert.ok(before.includes(String(2 * projectCalls(1, 2, GENERATION_SAMPLES_MAX, 2))));
});
test('AC-2/3: exported renderer refuses tampering, equal hashes and a changed whole grader', () => {
  const { ordered, loaded } = success(); const render = feature().renderCompareReport;
  for (const [label, mutate, reseal] of [
    ['invalid seal', (r) => { r.results.cases[0].mean = 0.1234; }, false],
    ['same hash', (r) => { r.skill.content_hash = ordered[0].skill.content_hash; }, true],
    ['samples', (r) => { r.run.judge.samples += 1; }, true],
    ['timeout', (r) => { r.run.timeout_ms = (r.run.timeout_ms || 1000) + 1; }, true],
    ['template', (r) => { r.run.judge.prompt_template_hash = 'a'.repeat(64); }, true],
    ['missing template', (r) => { delete r.run.judge.prompt_template_hash; }, true],
    ['judge surface', (r) => { r.run.judge.surface = 'anthropic-api'; }, true],
    ['temperature', (r) => { r.run.judge.temperature = 0.7; }, true],
  ]) {
    let bad = clone(ordered[1]); mutate(bad); if (reseal) bad = sealReceipt(bad);
    assert.throws(() => render(ordered[0], bad, { a: loaded[0], b: loaded[1] }), undefined, label);
  }
});
test('AC-2/9: a B judge-template mismatch or fatal failure cannot leave a reading', () => {
  for (const plant of ['judge-template', 'fail-b']) {
    const f = fixture(); const r = invoke(f, [], plant);
    assert.notEqual(r.status, 0); assert.doesNotMatch(r.text, /Unknown command/i);
    assert.ok(r.events.some((e) => e.event === 'end' && e.side === 1), 'A really completed');
    assert.equal(fs.existsSync(path.join(f.out, 'compare.md')), false);
  }
});
test('AC-3: exported orchestration refuses an invalid pair before a call', async () => {
  const f = fixture(); fs.copyFileSync(f.subjects[0], f.subjects[1]);
  // The exported entry point must reach the same preflight without CLI defaults.
  await assert.rejects(() => feature().compareSubjects({ a: f.subjects[0], b: f.subjects[1],
    suite: f.suite, models: [MODEL], samples: 2, out: f.out }), /same|identical|nothing to compare/i);
  assert.equal(fs.existsSync(path.join(f.out, 'compare.md')), false);
});

test('A-722-1: ceiling comes from the sealed runner version and a mismatch is disclosed', () => {
  const { ordered, loaded, markdown } = success();
  assert.match(markdown, new RegExp('at most ' + GENERATION_SAMPLES_MAX + ' answers per task, for each way the task was run; the limit in Driftproof ' + ordered[0].run.runner_version.replaceAll('.', '\\.') + ', which this receipt records\\.'));
  assert.doesNotMatch(markdown, /SAMPLING\.max|run\.runner_version/);
  const changed = clone(ordered[1]); changed.run.runner_version = '0.0.1'; sealReceipt(changed);
  const read = feature().renderCompareReport(ordered[0], changed, { a: loaded[0], b: loaded[1] });
  for (const text of [read.terminal, read.markdown]) {
    assert.match(text, /runner versions differ/i);
    assert.match(text, /0\.0\.1.*unknown|unknown.*0\.0\.1/);
    assert.doesNotMatch(text, /scored clearly|REVISION IMPROVED|REVISION REGRESSED/);
    assert.doesNotMatch(text, /SAMPLING\.max|run\.runner_version/, 'an unknown ceiling names no code identifier either');
  }
});
test('AC-1: mixed kinds refuse before any call', () => {
  const f = fixture(); const directory = fixture({ directories: true });
  f.subjects[1] = directory.subjects[1];
  refusal(f, invoke(f), /kind|directory|--suite/i);
});
test('AC-8/9: invalid input and occupied reading refuse before any call', () => {
  for (const args of [['--samples', '0'], ['--max-calls', '-1'], ['--max-usd', 'NaN'], ['--suite'], ['--out'], ['--typo']]) {
    const f = fixture(); refusal(f, invoke(f, args), /expected|requires|unknown|suite/i);
  }
  const f = fixture(); fs.mkdirSync(f.out); fs.writeFileSync(path.join(f.out, 'compare.md'), 'Previous comparison.');
  const r = invoke(f); assert.notEqual(r.status, 0); assert.match(r.text, /exist|taken/i);
  assert.equal(r.events.filter((e) => e.event === 'call').length, 0);
  assert.equal(fs.readFileSync(path.join(f.out, 'compare.md'), 'utf8'), 'Previous comparison.');
});
test('AC-2: working-directory settings are shared and skill-local settings cannot move them', () => {
  const f = fixture({ directories: true });
  fs.writeFileSync(path.join(f.dir, '.driftproofrc'), JSON.stringify({ samples: 3, concurrency: 2, judge_model: MODEL, capture: 'text' }));
  fs.writeFileSync(path.join(f.subjects[0], '.driftproofrc'), JSON.stringify({ samples: 9, capture: 'files', models: 'not-registered' }));
  const r = invoke(f); assert.equal(r.status, 0, r.text);
  const begins = r.events.filter((e) => e.event === 'begin');
  assert.deepEqual(begins[0].settings, begins[1].settings);
  assert.equal(begins[0].settings.samples, 2, 'CLI overrides working-directory rc');
  assert.equal(begins[0].settings.concurrency, 2);
  assert.equal(begins[0].settings.capture, 'text');
});
test('AC-1/4: a successful placebo comparison records three arms on both sides', () => {
  const f = fixture(); const r = invoke(f, ['--placebo']); assert.equal(r.status, 0, r.text);
  const { ordered } = pair(f, receipts(f));
  for (const [i, receipt] of ordered.entries()) {
    assert.deepEqual([...new Set(receipt.results.cases.map((c) => c.mode))].sort(), ['baseline', 'placebo', 'with_skill']);
    countOracle(receipt, r.events.filter((e) => e.event === 'call' && e.side === i + 1));
  }
});

test('AC-1: different deterministic checks cannot hide behind equal core suite hashes', () => {
  const f = fixture({ directories: true });
  const file = path.join(f.subjects[1], 'evals/evals.json');
  const suite = JSON.parse(fs.readFileSync(file, 'utf8')); suite.cases[0].checks = [{ type: 'contains', value: 'hello' }];
  fs.writeFileSync(file, JSON.stringify(suite));
  refusal(f, invoke(f), /tasks|checks|suite/i);
});
test('AC-9: multiple models produce a pair each and caps cover every pair', () => {
  const models = MODEL + ',claude-sonnet-5';
  const f = fixture(); const r = invoke(f, ['--models', models]);
  assert.equal(r.status, 0, r.text); assert.equal(receipts(f).length, 4);
  const starts = r.events.filter((e) => e.event === 'begin');
  assert.deepEqual(starts.map((e) => e.model), [MODEL, MODEL, 'claude-sonnet-5', 'claude-sonnet-5']);
  const bad = fixture(); refusal(bad, invoke(bad, ['--models', models, '--max-calls', String(projectCalls(1, 2, GENERATION_SAMPLES_MAX) * 2)]), /max-calls/, 3);
});
test('AC-10: ordinary validate, view, stale and blind doors read compare receipts', () => {
  const { f } = success();
  const file = path.join(f.out, fs.readdirSync(f.out).find((name) => name.endsWith('.json')));
  for (const args of [
    ['validate', file], ['view', f.out, '--out', path.join(f.dir, 'view.html'), '--no-harness-check'],
    ['stale', file, '--no-harness-check'], ['blind', file],
  ]) {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'bin/driftproof'), ...args], {
      cwd: f.dir, env: env(), encoding: 'utf8', timeout: 1800000,
    });
    assert.ifError(r.error);
    if (args[0] === 'blind') {
      assert.match(r.stdout + r.stderr, /kept|answers|transcripts/i, 'ordinary missing-answers refusal');
      assert.doesNotMatch(r.stdout + r.stderr, /invalid receipt|hash does not verify/i);
    } else if (args[0] === 'stale') assert.ok([0, 2, 3].includes(r.status), r.stderr);
    else assert.equal(r.status, 0, r.stderr);
  }
});

test('AC-4/5: a lost baseline arm is an unmeasured result, not changed task settings', () => {
  const f = fixture(); const r = invoke(f, [], 'lost-baseline');
  assert.equal(r.status, 0, r.text);
  const { loaded, ordered } = pair(f, receipts(f));
  assert.equal(ordered[1].run.status, 'incomplete');
  const row = ordered[1].results.cases.find((c) => c.mode === 'baseline');
  assert.ok(row.generation.draws.every((d) => d.status === 'unmeasured'));
  assert.equal(row.generation.n_drawn, r.events.filter((e) => e.event === 'call' && e.side === 2 && !e.judge && !e.system).length);
  const markdown = fs.readFileSync(path.join(f.out, 'compare.md'), 'utf8');
  readingOracle(markdown, loaded, ordered, true);
  assert.match(markdown, /B.*incomplete/i);
  assert.match(markdown, /so no comparison is made/);
  assert.doesNotMatch(markdown, /revision verdict is computed/);
  assert.ok(markdown.includes(NOT_MEASURED_LINE), 'the sentence specs 744 and 746 read');
  assert.doesNotMatch(markdown, /scored clearly|REVISION IMPROVED|REVISION REGRESSED/);
});


// Issue 730: the oracle constructs retained bytes independently of the scanner.
const SECTION_CAVEATS = [
  'On these tasks, this judge, this day.',
  'No clear difference is not proof the section does nothing.',
  'A shorter file is also a shorter file, so length moved too.',
  'Sections can matter together in ways one removal cannot see.',
];
function sectionFixture() {
  const f = fixture();
  f.prefix = Buffer.from('\ufeffPreamble stays.\r\n# Keep\r\nKeep this.\r\n');
  f.removed = Buffer.from('## Tone\r\nBe kind.\r\n### Detail\r\nUse examples.\r\n\x60\x60\x60md\r\n# Fake\r\n\x60\x60\x60\r\n~~~\r\n## Fake too\r\n~~~\r\n');
  f.suffix = Buffer.from('## End\r\nKeep the end.');
  f.original = Buffer.concat([f.prefix, f.removed, f.suffix]);
  f.reduced = Buffer.concat([f.prefix, f.suffix]);
  fs.writeFileSync(f.subjects[0], f.original);
  f.subjects = [f.subjects[0]];
  return f;
}
function sectionOracle(actual, f) {
  assert.deepEqual(actual, f.reduced, 'every retained byte is exact');
}
function sectionListOracle(rows, f) {
  assert.deepEqual(rows.map((s) => [s.heading, s.level]), [['Keep', 1], ['Tone', 2], ['Detail', 3], ['End', 2]]);
  const tone = rows.find((s) => s.heading === 'Tone');
  assert.equal(tone.start, f.prefix.length); assert.equal(tone.end, f.prefix.length + f.removed.length);
  assert.equal(tone.bytes, f.removed.length); assert.equal(tone.tokens, estimateTokens(f.removed.toString('utf8')));
}
function sectionArtifacts(f, text) {
  const files = fs.readdirSync(f.out).filter((n) => n.endsWith('.md') && n !== 'compare.md');
  assert.deepEqual(files, ['before.without-tone.md'], 'B file retained beside receipts');
  const bytes = fs.readFileSync(path.join(f.out, files[0])); sectionOracle(bytes, f);
  assert.ok(text.includes(sha(bytes)), 'B hash printed');
}
function sectionReadingOracle(text, f) {
  assert.match(text, /Removing 'Tone'/);
  assert.ok(text.includes(f.removed.length + ' bytes'));
  assert.ok(text.includes('about ' + estimateTokens(f.removed.toString('utf8')) + ' tokens'));
  assert.ok(text.includes((100 * f.removed.length / f.original.length).toFixed(1) + '% of the file'));
  for (const sentence of SECTION_CAVEATS) assert.ok(text.includes(sentence), 'removal caveat: ' + sentence);
  assert.doesNotMatch(text, /\bdelete\b/i, 'no delete advice');
  assert.match(text, /not measured/i, 'stub stays unmeasured');
  assert.doesNotMatch(text, /clearly (?:lowered|raised|lower|higher)/, 'no measured stub claim');
}
let sectionAccepted;
function sectionSuccess() {
  if (sectionAccepted) return sectionAccepted;
  const f = sectionFixture(); const r = invoke(f, ['--without-section', 'Tone']);
  assert.equal(r.status, 0, r.text);
  const bFile = path.join(f.out, 'before.without-tone.md');
  const loaded = [loadSubject(f.subjects[0], { suite: f.suite }), loadSubject(bFile, { suite: f.suite })];
  const list = receipts(f), ordered = loaded.map((s) => list.find((x) => x.skill.content_hash === s.contentHash));
  assert.equal(list.length, 2); assert.ok(ordered.every(Boolean));
  sectionAccepted = { f, r, loaded, ordered, markdown: fs.readFileSync(path.join(f.out, 'compare.md'), 'utf8') };
  return sectionAccepted;
}
test('730 AC-1/2: scan and slice preserve BOM, CRLF, nesting, fences and final bytes', () => {
  const f = sectionFixture();
  const rows = feature().listSections(f.original); sectionListOracle(rows, f);
  const removed = feature().removeSection(f.original, 'Tone'); sectionOracle(removed.bytes, f);
  assert.throws(() => sectionOracle(f.reduced.subarray(1), f), /retained byte/);
  assert.throws(() => sectionListOracle([...rows, { heading: 'Fake', level: 1 }], f));
  assert.throws(() => sectionListOracle(rows.map((s) => s.heading === 'Tone' ? { ...s, bytes: 1 } : s), f));
  for (const [source, heading, expected] of [
    ['\ufeff# First\nGone\n# Next\nKept\n', 'First', '\ufeff# Next\nKept\n'],
    ['Preamble\n# Last\nGone', 'Last', 'Preamble\n'],
    ['Preamble\n  ## A ###\nGone\n## B\nKept', 'A', 'Preamble\n## B\nKept'],
    ['Preamble\n\nTitle\n=====\nGone\nNext\n----\nNested\n# End\nKept', 'Title', 'Preamble\n\n# End\nKept'],
    ['Preamble\n# Tone\nGone\n\x60\x60\x60\x60\n# Fake\n\x60\x60\x60\n# Still fake\n\x60\x60\x60\x60\n# End\nKept', 'Tone', 'Preamble\n# End\nKept'],
    ['Preamble\n# Tone\nGone\n~~~\n# Fake\n\x60\x60\x60\n# Still fake\n~~~\n# End\nKept', 'Tone', 'Preamble\n# End\nKept'],
    ['Preamble\n    # Code\n# Tone\nGone\n# End\nKept', 'Tone', 'Preamble\n    # Code\n# End\nKept'],
  ]) assert.deepEqual(feature().removeSection(Buffer.from(source), heading).bytes, Buffer.from(expected));
});
test('730 AC-2: ambiguity and missing headings refuse by literal name', () => {
  for (const [source, heading, reason] of [
    ['# Tone\nA\n# Tone\nB\n', 'Tone', /Tone.*(?:ambiguous|matches 2)/i],
    ['# Tone\nA\n', '.*', /\.\*.*(?:matches 0|not found)/i],
    ['No headings here.\n', 'Tone', /file has no headings to remove/i],
    ['# Tone\nOnly section\n', 'Tone', /letter|empty|nothing/i],
  ]) {
    const f = sectionFixture(); fs.writeFileSync(f.subjects[0], source);
    const r = invoke(f, ['--without-section', heading]); refusal(f, r, reason);
    assert.throws(() => refusal(f, { ...r, status: 0 }, reason), undefined, 'accepted ambiguous plant');
  }
});
test('730 AC-3/4: exact B and hashes survive ordinary receipts and a manual pair replay', () => {
  const { f, r, loaded, ordered } = sectionSuccess();
  sectionArtifacts(f, r.stdout); sectionArtifacts(f, fs.readFileSync(path.join(f.out, 'compare.md'), 'utf8'));
  assert.equal(ordered[0].skill.content_hash, sha(f.original)); assert.equal(ordered[1].skill.content_hash, sha(f.reduced));
  assert.deepEqual(settings(ordered[0]), settings(ordered[1]));
  for (const [i, receipt] of ordered.entries()) countOracle(receipt, r.events.filter((e) => e.event === 'call' && e.side === i + 1));
  const first = r.events.findIndex((e) => e.event === 'call');
  assert.match(r.events.slice(0, first).filter((e) => e.event === 'stdout').map((e) => e.text).join(''), /projected synthetic calls/i);
  assert.throws(() => sectionArtifacts(f, r.stdout.replaceAll(sha(f.reduced), 'missing')), /hash printed/);
  const saved = fs.readFileSync(loaded[1].file); fs.unlinkSync(loaded[1].file);
  assert.throws(() => sectionArtifacts(f, r.stdout), /B file/); fs.writeFileSync(loaded[1].file, saved);
  const manual = { ...f, subjects: loaded.map((s) => s.file), out: path.join(f.dir, 'manual') };
  const replay = invoke(manual); assert.equal(replay.status, 0, replay.text);
  assert.deepEqual(receipts(manual).map((x) => x.skill.content_hash).sort(), ordered.map((x) => x.skill.content_hash).sort());
  const invalid = success();
  assert.throws(() => feature().renderCompareReport(...invalid.ordered, { a: invalid.loaded[0], b: invalid.loaded[1], withoutSection: 'Tone' }));
});
test('730 AC-5/6: removal readings and negative wording plants', () => {
  const { f, r, markdown, loaded, ordered } = sectionSuccess();
  for (const text of [r.stdout, markdown]) {
    sectionReadingOracle(text, f);
    for (const sentence of SECTION_CAVEATS) assert.throws(() => sectionReadingOracle(text.replace(sentence, ''), f), /caveat/);
    assert.throws(() => sectionReadingOracle(text + '\nDelete this section.', f), /delete advice/);
    assert.throws(() => sectionReadingOracle(text.replaceAll('not measured', 'clearly lowered scores'), f));
    assert.throws(() => sectionReadingOracle(text.replaceAll('not measured', 'scored clearly lower than A (the whole file)'), f));
  }
  const render = feature().renderCompareReport;
  assert.throws(() => render(...ordered, { a: loaded[0], b: { ...loaded[1], skillMd: loaded[1].skillMd + 'x' }, withoutSection: 'Tone' }));
  // Consistent hashes alone cannot turn a different B into the named removal.
  const unrelated = { ...loaded[1], skillMd: loaded[1].skillMd + 'Other words.' };
  unrelated.contentHash = sha(Buffer.from(unrelated.skillMd));
  const resealed = clone(ordered[1]);
  resealed.skill.content_hash = unrelated.contentHash;
  resealed.skill.tokens = estimateTokens(unrelated.skillMd);
  sealReceipt(resealed);
  assert.equal(validateReceipt(resealed).valid, true);
  assert.throws(() => render(ordered[0], resealed, { a: loaded[0], b: unrelated, withoutSection: 'Tone' }), /exact named section removal/);

  for (const [row, expected] of [
    [{ verdict: 'regression' }, NAMES.removal.b + ' scored clearly lower than ' + NAMES.removal.a],
    [{ verdict: 'improvement' }, NAMES.removal.b + ' scored clearly higher than ' + NAMES.removal.a],
    [{ verdict: 'within noise' }, 'no clear difference'], [{ verdict: 'within noise (below effect floor)' }, 'no clear difference'],
    [{ verdict: 'within noise', power: {} }, 'too few answers'], [{ verdict: 'not measured' }, 'not measured'],
    [{ verdict: 'refused' }, 'refused'], [{ verdict: 'inconclusive' }, 'inconclusive'], [{ verdict: 'n/a' }, 'not measured'],
  ]) assert.equal(feature().removalCaseReading(row), expected);
});
test('730 AC-7: caps refuse before B or any call, including placebo', () => {
  for (const placebo of [false, true]) for (const flag of ['--max-calls', '--max-usd']) {
    const f = sectionFixture(); const r = invoke(f, ['--without-section', 'Tone', flag, flag === '--max-calls' ? '1' : '0', ...(placebo ? ['--placebo'] : [])]);
    refusal(f, r, new RegExp(flag), 3);
    assert.throws(() => refusal(f, { ...r, events: [...r.events, { event: 'call' }] }, new RegExp(flag), 3), /before|precedes/);
  }
});
test('730 AC-4/7: placebo and failed run use the existing compare protections', () => {
  const f = sectionFixture(); const r = invoke(f, ['--without-section', 'Tone', '--placebo']);
  assert.equal(r.status, 0, r.text);
  for (const receipt of receipts(f)) assert.deepEqual([...new Set(receipt.results.cases.map((c) => c.mode))].sort(), ['baseline', 'placebo', 'with_skill']);
  for (const plant of ['judge-template', 'fail-b']) {
    const bad = sectionFixture(); const result = invoke(bad, ['--without-section', 'Tone'], plant);
    assert.notEqual(result.status, 0); assert.equal(fs.existsSync(path.join(bad.out, 'compare.md')), false);
  }
  const lost = sectionFixture(); const result = invoke(lost, ['--without-section', 'Tone'], 'lost-baseline');
  assert.equal(result.status, 0, result.text); sectionReadingOracle(result.stdout, lost);
});
test('730 AC-7: occupied B and invalid argument combinations refuse without calls', () => {
  for (const extra of [[], ['--without-section'], ['--without-section', 'Tone', '--list-sections'], ['--without-section', 'Tone', '--without-section', 'End']]) {
    const f = sectionFixture(); refusal(f, invoke(f, extra), /expected|requires|one|together|either/i);
  }
  const f = sectionFixture(); fs.mkdirSync(f.out); const b = path.join(f.out, 'before.without-tone.md');
  fs.writeFileSync(b, 'Prior file'); const r = invoke(f, ['--without-section', 'Tone']);
  assert.equal(r.status, 2, r.text); assert.match(r.text, /exist|taken/i);
  assert.equal(r.events.filter((e) => e.event === 'call').length, 0); assert.equal(fs.readFileSync(b, 'utf8'), 'Prior file');
});
test('730 AC-7: hostile heading is literal data and escaped in both outputs', () => {
  const f = sectionFixture(), heading = 'Tone.* [x] $(touch sentinel)' + String.fromCharCode(27) + '[31m';
  fs.writeFileSync(f.subjects[0], 'Preamble\n# ' + heading + '\nRemoved.\n# End\nKept.\n');
  const r = invoke(f, ['--without-section', heading]); assert.equal(r.status, 0, r.text);
  assert.ok(r.stdout.includes(termText(heading))); assert.ok(fs.readFileSync(path.join(f.out, 'compare.md'), 'utf8').includes(mdText(heading)));
  assert.ok(!r.stdout.includes(String.fromCharCode(27))); assert.equal(fs.existsSync(path.join(f.dir, 'sentinel')), false);
  const headingOnly = '形';
  assert.deepEqual(feature().removeSection(Buffer.from('Preamble\n# ' + headingOnly + '\nGone\n# End\nKept'), headingOnly).bytes, Buffer.from('Preamble\n# End\nKept'));
});
test('730 AC-7: exported entry point cannot bypass invalid removal checks', async () => {
  const f = sectionFixture(); fs.writeFileSync(f.subjects[0], '# Tone\nA\n# Tone\nB\n');
  await assert.rejects(() => feature().compareSubjects({ a: f.subjects[0], withoutSection: 'Tone', suite: f.suite, models: [MODEL], out: f.out }), /Tone.*(?:ambiguous|matches 2)/i);
  assert.equal(fs.existsSync(f.out), false);
  await assert.rejects(() => feature().compareSubjects({ a: f.subjects[0], b: f.subjects[0], withoutSection: 'Tone', suite: f.suite, out: f.out }), /one|either|two/i);
});
test('730 AC-8: listing is offline, needs no suite and reports nested byte ranges', () => {
  const f = sectionFixture(); f.directories = true; // invoke omits --suite.
  const r = invoke(f, ['--list-sections']); assert.equal(r.status, 0, r.text);
  assert.equal(r.events.filter((e) => e.event === 'call').length, 0); assert.equal(fs.existsSync(f.out), false);
  assert.match(r.stdout, new RegExp('level 2.*Tone.*' + f.removed.length + ' bytes.*' + estimateTokens(f.removed.toString('utf8')) + ' estimated tokens'));
  assert.doesNotMatch(r.stdout, /Fake/);
  fs.writeFileSync(f.subjects[0], 'No headings here.');
  refusal(f, invoke(f, ['--list-sections']), /file has no headings to remove/i);
});
// Issue 756 (A-722-5): --out is read where it really is, so a link cannot put receipts inside a subject.
const treeOf = (dir) => fs.readdirSync(dir, { recursive: true }).sort();
test('AC-9 (A-722-5): an --out that reaches a skill directory through a link is refused', () => {
  const plants = [
    ['a link to the skill', (f) => { fs.symlinkSync(f.subjects[0], f.out); }],
    ['a folder not yet made under a link to the skill', (f) => { const via = path.join(f.dir, 'via'); fs.symlinkSync(f.subjects[1], via); f.out = path.join(via, 'results'); }],
    ['a link to the parent, then the skill', (f) => { const via = path.join(f.dir, 'via'); fs.symlinkSync(f.dir, via); f.out = path.join(via, 'before', 'results'); }],
    ['a link to a folder inside the skill', (f) => { fs.symlinkSync(path.join(f.subjects[0], 'evals'), f.out); }],
    ['a dangling link into the skill', (f) => { fs.symlinkSync(path.join(f.subjects[0], 'results'), f.out); }],
  ];
  for (const [name, plant] of plants) {
    const f = fixture({ directories: true }); plant(f);
    const before = f.subjects.map(treeOf);
    const r = invoke(f);
    assert.equal(r.status, 2, name + ': ' + r.text);
    assert.match(r.text, /outside both skill directories|points nowhere/, name);
    assert.equal(r.events.filter((x) => x.event === 'call').length, 0, name + ': no call');
    assert.deepEqual(f.subjects.map(treeOf), before, name + ': the subjects are unchanged');
  }
});
test('AC-9 (A-722-5): a link to a folder outside both skills still runs', () => {
  const f = fixture({ directories: true }), elsewhere = path.join(f.dir, 'elsewhere');
  fs.mkdirSync(elsewhere); fs.symlinkSync(elsewhere, f.out);
  const r = invoke(f);
  assert.equal(r.status, 0, r.text);
  assert.ok(fs.existsSync(path.join(elsewhere, 'compare.md')), 'the reading is written through the link');
});
// Issue 756 (A-722-6): a root that cannot be resolved, such as a missing Windows drive, ends the walk.
// The counter turns a walk that never ends into a red test rather than a hang.
test('AC-9 (A-722-6): the results-folder walk ends at a Windows-style root', () => {
  const absent = () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); };
  for (const [out, levels] of [['Z:\\results\\today', 3], ['\\\\server\\share\\results', 2]]) {
    let passes = 0;
    const real = () => { if (++passes > 16) throw new Error('the walk did not end'); return absent(); };
    assert.equal(feature().realOutPath(out, { paths: path.win32, real, lstat: absent }), out);
    assert.equal(passes, levels, out);
  }
});
// Issue 756 (A-730-2): the closing-hash trim takes one pass and reads what the old pattern read.
test('730 AC-2 (A-730-2): a 40k-space heading line lists in under 100 ms and keeps its text', () => {
  const inner = 'a' + ' '.repeat(40000) + 'b', started = performance.now();
  const rows = feature().listSections(Buffer.from('# ' + inner + '\n'));
  const ms = performance.now() - started;
  assert.ok(ms < 100, ms + ' ms');
  assert.deepEqual(rows.map((r) => r.heading), [inner]);
});
test('730 AC-2 (A-730-2): every short heading reads as the old closing-hash pattern read it', () => {
  const old = (text) => text.replace(/(?:^|[ \t]+)#+[ \t]*$/, '').trim();
  const alphabet = ['#', ' ', '\t', 'a', String.fromCodePoint(0xa0)];
  let bodies = [''], seen = 0;
  for (let length = 0; length <= 6; length++) {
    for (const body of bodies) {
      const rows = feature().listSections(Buffer.from('# ' + body + '\n'));
      assert.deepEqual(rows.map((r) => r.heading), [old(body.replace(/^[ \t]+/, ''))], JSON.stringify(body));
      seen++;
    }
    bodies = bodies.flatMap((body) => alphabet.map((c) => body + c));
  }
  assert.equal(seen, 19531);
});

// A-722-4: the same-user lane. A fake `claude` on the operator PATH shows which lane a comparison took, as
// spec 022's AC-5 control does. It answers judge prompts with a grade, and no model is reached.
function operatorShim(f) {
  const { CLAUDE_CANNED, CLAUDE_JUDGE } = require('../specs/022-eval-user-isolation/probes/common');
  const dir = path.join(f.dir, 'shim'), marker = path.join(f.dir, 'shim-ran');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'claude'), '#!' + process.execPath + '\n' +
    'const fs=require("fs");fs.appendFileSync(' + JSON.stringify(marker) + ',"x\\n");\n' +
    'if(process.argv.includes("--version")){process.stdout.write("1.0.0 (Claude Code)\\n");process.exit(0);}\n' +
    'let input="";process.stdin.on("data",d=>input+=d);process.stdin.on("end",()=>process.stdout.write(/Return ONLY this JSON object/.test(input)?' +
    JSON.stringify(CLAUDE_JUDGE) + ':' + JSON.stringify(CLAUDE_CANNED) + '));\n', { mode: 0o755 });
  const shimEnv = env({ PATH: dir + path.delimiter + process.env.PATH, DRIFTPROOF_EVAL_USER: 'driftproof-eval-does-not-exist' });
  delete shimEnv.DRIFTPROOF_STUB;
  return { marker, env: shimEnv };
}
function onOperatorPath(f, shim, extra = []) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'bin/driftproof'), 'compare', ...f.subjects, '--suite', f.suite,
    '--models', MODEL, '--samples', '1', '--out', f.out, ...extra], { cwd: f.dir, env: shim.env, encoding: 'utf8', timeout: 1800000 });
  assert.ifError(r.error);
  return { ...r, text: (r.stdout || '') + (r.stderr || '') };
}
test('A-722-4: with no isolation account compare refuses naming a flag it takes, and with the flag reaches the operator-path CLI on one lane', () => {
  const f = fixture(), shim = operatorShim(f);
  const refused = onOperatorPath(f, shim);
  assert.equal(refused.status, 2, refused.text);
  assert.match(refused.text, /--trusted-skill/);
  assert.equal(fs.existsSync(shim.marker), false, 'no flag, no same-user call');
  assert.equal(fs.existsSync(f.out), false, 'nothing written');

  const yes = onOperatorPath(f, shim, ['--trusted-skill']);
  assert.equal(yes.status, 0, yes.text);
  assert.doesNotMatch(yes.text, /unknown flag/);
  assert.ok(fs.existsSync(shim.marker), 'the flag reached the operator-path CLI');
  assert.match(yes.text, /isolation: same-user/);
  const list = receipts(f);
  assert.equal(list.length, 2);
  for (const r of list) { assert.equal(r.run.judge.isolation, 'same-user'); assert.equal(r.run.answered_by.isolation, 'same-user'); }
  assert.ok(fs.existsSync(path.join(f.out, 'compare.md')), 'the reading was written');

  const help = spawnSync(process.execPath, [path.join(ROOT, 'bin/driftproof'), '--help'], { env: env(), encoding: 'utf8' });
  assert.match(help.stdout.split('\n').find((l) => / compare <A> <B>/.test(l)), /--trusted-skill/);
});
test('A-722-4: one lane reaches both sides, and only the flag sets it', async () => {
  const f = fixture(), r = invoke(f, ['--trusted-skill']);
  assert.equal(r.status, 0, r.text);
  const starts = r.events.filter((e) => e.event === 'begin');
  assert.equal(starts.length, 2);
  assert.ok(starts.every((e) => e.settings.trusted === true), 'both sides take the flag');
  assert.ok(r.events.filter((e) => e.event === 'call').every((e) => e.trusted === true), 'every call takes the flag');

  const plain = fixture();
  fs.writeFileSync(path.join(plain.dir, '.driftproofrc'), JSON.stringify({ trusted_skill: true, trusted: true, 'trusted-skill': true }));
  const without = invoke(plain);
  assert.equal(without.status, 0, without.text);
  assert.ok(without.events.filter((e) => e.event === 'begin').every((e) => e.settings.trusted === false), 'no configuration file sets the lane');

  await assert.rejects(async () => feature().compareSubjects({ a: f.subjects[0], b: f.subjects[1], suite: f.suite, out: path.join(f.dir, 'x'), trusted: 'yes' }), /trusted/);
});
