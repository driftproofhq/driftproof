// SPDX-License-Identifier: Apache-2.0
'use strict';
// Issue 640 (spec 640): the step-by-step walk-through. Each test reads the page the builder makes and
// the receipt it names itself, so a check never takes the builder's word for what the receipt says.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const P17 = require('../scripts/prepare-report-017.js');
const { plainOf, KEY, LABELS } = require('../lib/plain');
const { placeboLine, placeboReading, receiptVerdict, armOf, PLACEBO_WORDS, UNDERPOWERED_LINE } = require('../lib/verdict');
const { sealReceipt } = require('../lib/receipt');
const { suiteIdentity } = require('../lib/skill');
const { SAMPLING } = require('../lib/sampling');
const { EFFECT_FLOOR } = require('../config');
const { humanModelName } = require('../scripts/model-names');
const ROOT = path.resolve(__dirname, '..');
const REL = 'how-it-works/index.html';
const PAGE = 'docs/' + REL;
const SKILLS = 'specs/640-how-it-works/skills';
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const scratch = (name) => fs.mkdtempSync(path.join(process.env.TMPDIR || '/var/tmp', name));
// Loaded inside each test, so a missing builder reads red test by test.
const H = () => require('../scripts/how-it-works.js');
const { tokenize, attrOf: tokenAttr } = require('../scripts/html-text.js');
let campaign;
const C = () => (campaign ||= P17.readCampaign({ campaignRoot: path.join(ROOT, P17.CAMPAIGN) }));
// The test's own hand-off reading, written apart from the builder's: the body after the front
// matter is nothing but lines that call the Skill tool.
const bodyOf = (t) => t.replace(/^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
const handoffOracle = (t) => bodyOf(t).split(/\r?\n/).filter((l) => l.trim()).every((l) => /^Call the Skill tool\b.*\.$/.test(l.trim()));
const textOfRow = (r) => fs.readFileSync(path.join(ROOT, SKILLS, r.attempt_id + '.md'), 'utf8');
// The example by the test's own ordering: non-routers with a receipt, by skill_bytes then plan order,
// the first whose text is not a hand-off.
const oraclePick = () => C().rows.filter((r) => !r.router && r.receipt).sort((a, b) => a.receipt.placebo.skill_bytes - b.receipt.placebo.skill_bytes || a.index - b.index).find((r) => !handoffOracle(textOfRow(r)));
const answersOf = (row) => JSON.parse(read(row.src.replace(/\.json$/, '-answers.json')));
// A campaign whose picked row carries a changed receipt (and attempt), resealed so the plant reaches the check it names.
function planted(edit, { reseal = true, attempt = (a) => a } = {}) {
  const pick = oraclePick();
  const rows = C().rows.map((r) => {
    if (r.attempt_id !== pick.attempt_id) return r;
    const receipt = structuredClone(r.receipt); edit(receipt); if (reseal) sealReceipt(receipt);
    return { ...r, receipt, attempt: attempt(structuredClone(r.attempt)) };
  });
  return { ...C(), rows };
}
const html = () => read(PAGE);
const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const text = (h) => decode(h.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').replace(/\s+([.,;:!?])/g, '$1').trim();
const steps = (h) => [...h.matchAll(/<section\b[^>]*\bdata-step="(\d)"[^>]*>([\s\S]*?)<\/section>/g)].map((m) => ({ n: +m[1], html: m[2] }));
// Quoted material: the prompt, guide, excerpts, reasons and openings (data-quote="text") and the
// library's own lines (data-quote="library"). Neither is the page's own wording.
const without = (h, kinds) => h.replace(/<(\w+)\b[^>]*\bdata-quote="([a-z]+)"[^>]*>[\s\S]*?<\/\1>/g, (m, tag, kind) => (kinds.includes(kind) ? ' ' : m));
const elementOf = (h, attr) => { const m = new RegExp('<(\\w+)\\b([^>]*\\b' + attr + '[^>]*)>([\\s\\S]*?)<\\/\\1>').exec(h); return m ? { attrs: m[2], inner: m[3], outer: m[0] } : null; };
const element = (h, attr) => (elementOf(h, attr) || {}).inner || null;
const attrOf = (attrs, name) => { const m = new RegExp('\\b' + name + '="([^"]*)"').exec(attrs || ''); return m ? decode(m[1]) : null; };
const ownWords = (h) => text(without(steps(h).map((s) => s.html).join(' '), ['text', 'library']));
const words = (t) => t.split(/\s+/).filter((w) => /\p{L}/u.test(w)).length;
const firstTask = (receipt, suite) => suite.cases.map((c) => c.id).find((id) => receipt.results.cases.some((c) => c.id === id));
const rowOf = (receipt, id, mode) => receipt.results.cases.find((c) => c.id === id && c.mode === mode);
const drawZero = (receipt, id, mode) => rowOf(receipt, id, mode).generation.draws.find((d) => d.draw_index === 0);
const suiteFile = (row) => `docs/skills/receipts/issue-408/suites/${row.attempt.protocol.evals_sha256}.json`;
const suiteOf = (row) => JSON.parse(read(suiteFile(row)));
const MODES = ['with_skill', 'placebo', 'baseline'];
const fig = (h, name) => { const m = new RegExp(`<data\\b(?=[^>]*\\bdata-fig="${name}")[^>]*\\bvalue="([^"]*)"`).exec(h); return m && decode(m[1]); };
const dateOf = (r) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(r.run.date_utc));

test('AC-1 the example is the shortest counted skill that is not a hand-off, read without a score', () => {
  const pinned = C().rows.map((r) => ({ skill: r.skill, text: textOfRow(r), row: r }));
  assert.equal(pinned.length, 20);
  for (const p of pinned) assert.equal(sha(Buffer.from(p.text)), p.row.attempt.protocol.skill_sha256, p.skill);
  assert.deepEqual(pinned.filter((p) => H().isHandoff(p.text)).map((p) => p.skill).sort(), ['grill-me', 'grill-with-docs']);
  assert.deepEqual(pinned.filter((p) => handoffOracle(p.text)).map((p) => p.skill).sort(), ['grill-me', 'grill-with-docs']);
  const pick = oraclePick();
  assert.equal(pick.skill, 'handoff');
  const ex = H().exampleOf({ campaign: C() });
  assert.equal(ex.row.attempt_id, pick.attempt_id);
  assert.match(html(), new RegExp(`data-attempt="${pick.attempt_id}"`));
  // Every score changed, case means, draw means and samples included: the pick stands, so it reads none.
  const zero = (r) => { const x = structuredClone(r); x.comparison = { ...x.comparison, with_skill_score: 0, baseline_score: 1 }; for (const c of x.results.cases) { c.mean = c.score = c.mode === 'with_skill' ? 0 : 1; c.samples = c.samples.map(() => 0); for (const d of c.generation.draws) { d.mean = 0; d.samples = d.samples.map(() => 0); } } return x; };
  const scored = { ...C(), rows: C().rows.map((r) => (r.receipt ? { ...r, receipt: zero(r.receipt) } : r)) };
  assert.equal(H().pickOf(scored).row.attempt_id, pick.attempt_id);
  // Its length raised past every other: the rule moves on, to the next counted skill that is not a hand-off.
  const longer = { ...C(), rows: C().rows.map((r) => (r.attempt_id === pick.attempt_id ? { ...r, receipt: { ...r.receipt, placebo: { ...r.receipt.placebo, skill_bytes: 1e9 } } } : r)) };
  assert.equal(H().pickOf(longer).row.skill, 'grilling');
  assert.throws(() => H().pickOf(C(), { limit: () => ({ label: 'planted' }) }), (e) => e.code === 'HOW_EXAMPLE_ROUTER');
  const dir = scratch('how-it-works-skills-');
  for (const f of fs.readdirSync(path.join(ROOT, SKILLS))) fs.copyFileSync(path.join(ROOT, SKILLS, f), path.join(dir, f));
  const gm = C().rows.find((r) => r.skill === 'grill-me');
  fs.appendFileSync(path.join(dir, gm.attempt_id + '.md'), ' ');
  assert.throws(() => H().pickOf(C(), { skillsDir: dir }), (e) => e.code === 'HOW_SKILL_TEXT');
});

test('AC-2 the receipt is sealed and its answers rebuild its scores', () => {
  const pick = oraclePick();
  const task = firstTask(pick.receipt, suiteOf(pick));
  const edited = answersOf(pick);
  const at = edited.draws.findIndex((d) => d.id === task && d.mode === 'with_skill' && d.draw_index === 0);
  const was = drawZero(pick.receipt, task, 'with_skill').samples[0];
  edited.draws[at].judge_outputs[0] = JSON.stringify({ score: was === 0 ? 1 : 0, pass: false, reason: 'planted' });
  assert.throws(() => H().exampleOf({ campaign: C(), answers: edited }), (e) => e.code === 'SCORE_RECONSTRUCTION');
  const other = answersOf(pick); other.receipt_hash = '0'.repeat(64);
  assert.throws(() => H().exampleOf({ campaign: C(), answers: other }), (e) => e.code === 'HOW_ANSWER_BINDING');
  assert.throws(() => H().exampleOf({ campaign: planted((x) => { x.run.judge.samples = 4; }, { reseal: false }) }), (e) => e.code === 'RECEIPT_SEAL');
});

// The guide's numbered points, read from the rubric by the test.
const pointsOf = (rubric) => rubric.slice(rubric.indexOf('sum to a score from 0 to 1.') + 'sum to a score from 0 to 1.'.length).split(/\s*\b\d\.\s+/).map((s) => s.trim()).filter(Boolean);

test('AC-3 the prompt and the guide are the published suite\'s, bound to the plan and the receipt', () => {
  const pick = oraclePick();
  const bytes = fs.readFileSync(path.join(ROOT, suiteFile(pick)));
  assert.equal(sha(bytes), pick.attempt.protocol.evals_sha256);
  const suite = JSON.parse(bytes);
  assert.equal(suiteIdentity(suite).suiteHash, pick.receipt.suite.suite_hash);
  const c = suite.cases.find((x) => x.id === firstTask(pick.receipt, suite));
  assert.equal(decode(element(html(), 'data-prompt') || ''), c.prompt);
  const guide = element(html(), 'data-guide') || '';
  assert.deepEqual([...guide.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => decode(m[1])), pointsOf(c.rubric));
  assert.equal(pointsOf(c.rubric).length, 4);
  const changed = Buffer.from(bytes.toString('utf8').replace('Write a handoff', 'Write a summary'));
  assert.notEqual(changed.toString(), bytes.toString());
  assert.throws(() => H().exampleOf({ campaign: C(), suiteBytes: changed }), (e) => e.code === 'HOW_PROMPT_BINDING');
});

// The oracle for AC-4: each way's block holds the opening of the answer its first draw sealed, that
// draw's own scores, and the reason its first judge output sealed.
function excerptsHold(h, receipt, answers, task) {
  return MODES.every((mode) => {
    const d = drawZero(receipt, task, mode), full = answers.answers[d.generation_hash];
    const ev = answers.draws.find((x) => x.id === task && x.mode === mode && x.draw_index === 0);
    const block = element(h, `data-arm="${mode}"`), quote = block && elementOf(block, 'data-excerpt');
    if (!quote || sha(full) !== d.generation_hash || sha(ev.judge_outputs[0]) !== d.judge_sample_hashes[0]) return false;
    const raw = attrOf(quote.attrs, 'data-raw'), shown = text(quote.inner), t = text(block);
    const atWordEnd = raw === full || /\s/.test(full[raw.length]);
    return raw.length > 0 && [...raw].length <= 240 && full.startsWith(raw) && atWordEnd && !/\s$/.test(raw)
      && !/\*\*|(?:^|\s)#{1,6}\s|`/.test(shown) && shown.length > 0
      && t.includes(d.samples.join(', ')) && t.includes(String(d.mean)) && t.includes(String([...full].length))
      && t.includes(JSON.parse(ev.judge_outputs[0]).reason);
  });
}

test('AC-4 each way shows its first draw\'s opening, scores and sealed reason', () => {
  const pick = oraclePick(), answers = answersOf(pick);
  const task = firstTask(pick.receipt, suiteOf(pick));
  assert.ok(excerptsHold(html(), pick.receipt, answers, task));
  assert.match(text(html()), /shown as plain text/);
  // Two ways' blocks swapped in a copy: the oracle refuses it.
  const h = html(), a = elementOf(h, 'data-arm="with_skill"').outer, b = elementOf(h, 'data-arm="baseline"').outer;
  const swapped = h.replace(a, '\u0000').replace(b, a.replace('data-arm="with_skill"', 'data-arm="baseline"')).replace('\u0000', b.replace('data-arm="baseline"', 'data-arm="with_skill"'));
  assert.ok(!excerptsHold(swapped, pick.receipt, answers, task));
  const edited = answersOf(pick), d = drawZero(pick.receipt, task, 'placebo');
  edited.answers[d.generation_hash] = edited.answers[d.generation_hash].replace('Handoff', 'Hand-off');
  assert.notEqual(edited.answers[d.generation_hash], answersOf(pick).answers[d.generation_hash]);
  assert.throws(() => H().exampleOf({ campaign: C(), answers: edited }), (e) => e.code === 'HOW_ANSWER_BINDING');
  const reason = answersOf(pick), i = reason.draws.findIndex((x) => x.id === task && x.mode === 'baseline' && x.draw_index === 0);
  reason.draws[i].judge_outputs[0] = reason.draws[i].judge_outputs[0].replace('Meets', 'Meets all');
  assert.throws(() => H().exampleOf({ campaign: C(), answers: reason }), (e) => e.code === 'HOW_ANSWER_BINDING');
  assert.equal(H().excerptOf('one two three', 7), 'one two');
  assert.equal(H().excerptOf('one two', 240), 'one two');
});

const readingHolds = (h, receipt) => {
  const block = element(h, 'data-reading'), p = plainOf(receipt);
  if (!block) return false;
  const t = text(block), lib = [p.label, p.sentence, p.why].join(' ');
  const others = Object.values(LABELS).filter((l) => !lib.includes(l));
  return t.includes(p.label) && t.includes(p.sentence) && t.includes(p.why) && t.includes(placeboLine(placeboReading(receipt))) && others.every((l) => !t.includes(l));
};

test('AC-5 the reading is plainOf\'s label, sentence and why and placeboLine\'s words, verbatim', () => {
  const pick = oraclePick();
  assert.ok(readingHolds(html(), pick.receipt));
  const p = plainOf(pick.receipt);
  const block = elementOf(html(), 'data-reading').outer;
  assert.ok(!readingHolds(html().replace(block, block.replace(p.label, LABELS.PASSED)), pick.receipt));
});

test('AC-6 each step says only what the code and the receipt do', () => {
  const pick = oraclePick(), r = pick.receipt, h = html(), t = text(h);
  const task = firstTask(r, suiteOf(pick));
  assert.throws(() => H().exampleOf({ campaign: planted((x) => { x.run.judge.prompt_template_hash = 'f'.repeat(64); }) }), (e) => e.code === 'HOW_JUDGE_TEMPLATE');
  assert.throws(() => H().exampleOf({ campaign: planted((x) => { x.run.judge.model_id = x.run.model_id; }) }), (e) => e.code === 'HOW_JUDGE_SEPARATE');
  assert.throws(() => H().exampleOf({ campaign: planted((x) => { x.results.cases = x.results.cases.filter((c) => !(c.mode === 'placebo' && c.id === task)); }) }), (e) => e.code === 'HOW_ARMS');
  assert.throws(() => H().exampleOf({ campaign: planted((x) => { x.placebo.skill_bytes -= 1; }) }), (e) => e.code === 'PANEL_BINDING');
  assert.notEqual(r.run.judge.model_id, r.run.model_id);
  assert.ok(t.includes(humanModelName(r.run.model_id)) && t.includes(humanModelName(r.run.judge.model_id)));
  assert.match(t, /not told/);
  assert.match(t, /can still show which way/);
  assert.doesNotMatch(t, /without knowing|does not know|doesn't know|\bblind/i);
  assert.equal(fig(h, 'judge-samples'), String(r.run.judge.samples));
  for (const mode of MODES) assert.equal(fig(h, 'draws-' + mode), String(rowOf(r, task, mode).generation.draws.length));
  assert.equal(fig(h, 'skill-bytes'), String(r.placebo.skill_bytes));
  assert.equal(fig(h, 'placebo-bytes'), String(r.placebo.bytes));
  assert.equal(fig(h, 'sampling-min'), String(SAMPLING.min));
  assert.equal(fig(h, 'sampling-max'), String(SAMPLING.max));
  assert.equal(fig(h, 'effect-floor'), String(EFFECT_FLOOR));
  assert.match(t, /Each way answers the task at least \d+ times and at most \d+, stopping once the scores settle/);
  // Review fix 1, m4 and m5: the three ways named plainly, and what the openings leave out.
  assert.ok(t.includes('One way with the skill, one with a placebo, one with no skill text added.'));
  assert.ok(t.includes("Each text's first sentence (the skill's header lines are left out):"));
  assert.ok(t.includes('The whole placebo text is not shown on this page.'));
  // Every figure names its source, and the source is a file in the tree.
  const datas = [...h.matchAll(/<data\b[^>]*>/g)].map((m) => m[0]);
  assert.ok(datas.length > 10);
  for (const d of datas) { const src = /data-src="([^"]+)"/.exec(d); assert.ok(src && fs.existsSync(path.join(ROOT, src[1])), d); }
});

const FORBIDDEN = /more than chance|significan|statistical|\bproves?\b|confiden|within (?:the )?noise|moved beyond/i;
test('AC-7 the case rule in the library\'s words, as a rule and not a proof', () => {
  const t = text(html()), p = plainOf(oraclePick().receipt);
  for (const s of [LABELS.PASSED, KEY.PASSED, p.label, KEY[p.state], PLACEBO_WORDS.ABOVE_PLACEBO]) assert.ok(t.includes(s), s);
  assert.ok(t.includes(String(EFFECT_FLOOR)));
  assert.match(t, /not proof/);
  // Review fix 1, m1 and m2: the downward rung comes first, and "below the placebo" is defined.
  assert.ok(t.includes(`If any task is clearly lower, the reading is ${LABELS.REGRESSED}, whatever the others show.`));
  assert.ok(t.includes('Below the placebo means: the same case rule, measured against the placebo instead of no skill text: a task clearly lower.'));
  assert.doesNotMatch(t, FORBIDDEN);
  assert.match(t + ' by more than chance', FORBIDDEN);
});

function limitsMissing(t, r) {
  const need = [LABELS.UNDERPOWERED, UNDERPOWERED_LINE, KEY.UNDERPOWERED, 'does not mean the skill does nothing', 'does not mean beating no skill text', 'by chance', 'not a person', 'not proof', humanModelName(r.run.model_id), humanModelName(r.run.judge.model_id), dateOf(r)];
  return need.filter((n) => !t.includes(n));
}
test('AC-8 screen five says what a result does not tell you', () => {
  const five = steps(html()).find((s) => s.n === 5);
  assert.ok(five);
  const t = text(five.html), r = oraclePick().receipt;
  assert.deepEqual(limitsMissing(t, r), []);
  assert.deepEqual(limitsMissing(t.replace('by chance', ''), r), ['by chance']);
});

const TERMS = ['placebo', 'judge', 'case-rule', 'draw', 'effect-floor', 'receipt', 'score', 'spread'];
const JARGON = /\b(?:rubric|baselines?|arms?|seeds?|corpus|hash(?:es)?|bands?|verdicts?|delta|samples?|underpowered)\b/i;
function termsProblems(h) {
  const problems = [];
  const defs = [...h.matchAll(/<(\w+)\b[^>]*\bdata-term="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g)].map((m) => ({ terms: m[2].split(' '), text: text(m[3]) }));
  for (const term of TERMS) { const n = defs.filter((d) => d.terms.includes(term)).length; if (n !== 1) problems.push(`${term}: ${n} definitions`); }
  for (const d of defs) if ((d.text.replace(/\d\.\d/g, '0').match(/[.!?]/g) || []).length !== 1 || !/[.!?]$/.test(d.text)) problems.push(`not one sentence: ${d.text}`);
  const placebo = defs.find((d) => d.terms.includes('placebo'));
  if (placebo && /\b(?:inert|neutral|meaningless)\b/i.test(placebo.text)) problems.push('placebo called inert, neutral or meaningless');
  const own = ownWords(h); const j = JARGON.exec(own); if (j) problems.push(`jargon: ${j[0]}`);
  return problems;
}
test('AC-9 every term gets one plain sentence, and the steps use no unexplained jargon', () => {
  const h = html();
  assert.deepEqual(termsProblems(h), []);
  const first = steps(h)[0].html, para = /<p>/.exec(first);
  assert.ok(para);
  assert.notDeepEqual(termsProblems(h.replace(first, first.replace('<p>', '<p>The rubric decides. '))), []);
  assert.notDeepEqual(termsProblems(h.replace(/data-term="judge"/, 'data-was="judge"')), []);
  assert.notDeepEqual(termsProblems(h.replace(/(data-term="placebo"[^>]*>)/, '$1An inert text. ')), []);
});

const ALLOWED_SCRIPTS = new Set(['/islands/loader.js', '/copy-button.js', 'https://static.cloudflareinsights.com/beacon.min.js']);
// Issue 661: every script start tag, read by the tokenizer so `<SCRIPT>` and a ">" inside a quoted
// attribute read as a browser reads them (CodeQL js/bad-tag-filter): the ones that are neither an
// allowed source nor JSON-LD, as written.
const scriptProblems = (h) => tokenize(h).filter((t) => t.type === 'start' && t.name === 'script').filter((t) => {
  const src = tokenAttr(t, 'src');
  return src ? !ALLOWED_SCRIPTS.has(src) : tokenAttr(t, 'type') !== 'application/ld+json';
}).map((t) => t.raw);
test('AC-10 five screens in order, all shown without script, mounted by the island loader', () => {
  const h = html();
  assert.match(h, /data-island="how-it-works"/);
  assert.ok(fs.existsSync(path.join(ROOT, 'docs/islands/how-it-works.js')));
  assert.deepEqual(steps(h).map((s) => s.n), [1, 2, 3, 4, 5]);
  for (const s of steps(h)) assert.match(s.html, /<h2\b/);
  assert.doesNotMatch(h, /<section\b[^>]*\bhidden\b/);
  assert.deepEqual(scriptProblems(h), []);
  assert.ok(h.includes('</body>'));
  assert.deepEqual(scriptProblems(h.replace('</body>', '<SCRIPT SRC="/x.js"></SCRIPT></body>')), ['<SCRIPT SRC="/x.js">'], 'plant: an upper-case script tag is read');
  assert.deepEqual(scriptProblems(h.replace('</body>', '<script data-x="a>b" src="/y.js"></script></body>')), ['<script data-x="a>b" src="/y.js">'], 'plant: a ">" inside a quoted attribute stays inside the tag');
});

// Issue 661: the builder's own page-text reader (spec 020 AC-42's reading) is the tokenizer, not a tag
// pattern: a script end tag with white space, an upper-case tag and a ">" inside a quoted attribute
// each read as a browser reads them, and an entity is decoded once.
test('issue 661: the builder reads page text by the tokenizer, not by a tag pattern', () => {
  const { textOf } = H();
  assert.equal(textOf('<p>a</p><SCRIPT>x = "</p>"</SCRIPT ><p>b .</p>'), 'a b.');
  assert.equal(textOf('<STYLE>p{}</STYLE >f'), 'f');
  assert.equal(textOf('<a title="x > y">c</a><!-- d --> ( e )'), 'c (e )');
  assert.equal(textOf('<p>&amp;lt;b&amp;gt; &quot;q&quot; &#39;s&#39;</p>'), '&lt;b&gt; "q" \'s\'');
  assert.doesNotMatch(textOf(html()), /\.\.| - /, 'the real page, read this way, passes its own text check');
});

test('AC-11 the island fetches, stores and injects nothing, and the page claims no less than loads', () => {
  const code = read('docs/islands/how-it-works.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /\b(?:require|process|Buffer|fetch|XMLHttpRequest|WebSocket|EventSource|Worker|sendBeacon|localStorage|sessionStorage|indexedDB|history|location)\b|eval\s*\(|import\s*\(|^\s*import\b|innerHTML|outerHTML|insertAdjacentHTML|document\.write|\.cookie\b/m);
  assert.doesNotMatch(html(), /<(?:iframe|form|object|embed)\b/i);
  const t = text(html());
  assert.doesNotMatch(t, /no network requests?|makes no requests?|no requests? at all/i);
  if (/static\.cloudflareinsights\.com/.test(html())) assert.match(t, /Cloudflare Web Analytics/);
});

test('AC-12 no reading-time claim, and short screens', () => {
  const h = html(), t = text(h);
  const title = /<title>([^<]*)<\/title>/.exec(h)[1], description = /<meta name="description" content="([^"]*)"/.exec(h)[1];
  // A time claim: minutes, or seconds as a count ("a second AI model" is not one).
  const minute = /\bminutes?\b|\bseconds\b/i;
  for (const s of [t, title, description]) assert.doesNotMatch(s, minute, s.slice(0, 80));
  const home = /<a href="\/how-it-works\/">([^<]*)<\/a>/.exec(read('docs/index.html'));
  const readme = /\[([^\]]*)\]\(https:\/\/driftproofhq\.com\/how-it-works\/\)/.exec(read('README.md'));
  assert.ok(home && readme);
  for (const s of [home[1], readme[1]]) assert.doesNotMatch(s, minute);
  assert.match(t + ' in a minute', minute);
  const n = words(text(without(steps(h).map((s) => s.html).join(' '), ['text'])));
  assert.ok(n > 100 && n <= 800, `${n} words`);
  assert.equal(words(Array(801).fill('word').join(' ')) <= 800, false);
});

test('AC-13 the homepage\'s first screen and README link to the page', () => {
  const home = read('docs/index.html');
  const hero = /<section id="hero"[\s\S]*?<\/section>/.exec(home)[0];
  assert.ok(hero.includes('<a href="/how-it-works/">New to this? See how it works, step by step</a>'), 'the homepage hero links the page');
  assert.match(read('README.md'), /\[New to this\? See how it works, step by step\]\(https:\/\/driftproofhq\.com\/how-it-works\/\)/);
  assert.match(read('docs/sitemap-pages.xml'), /<loc>https:\/\/driftproofhq\.com\/how-it-works\/<\/loc>/);
});

test('AC-14 the committed page is the builder\'s, and its text reads as sentences', () => {
  const site = require('../scripts/build-site-pages.js');
  const built = require('../scripts/build-head-tags.js').render(site.TARGETS[REL](), REL);
  assert.equal(built, html());
  assert.notEqual(built, html().replace('placebo', 'placeb0'));
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/build-site-pages.js'), '--check'], { cwd: ROOT, stdio: 'pipe' });
  assert.doesNotMatch(text(html()), /\.\.| - /);
  assert.throws(() => H().assertPageText('<main><p>one - two</p></main>'), (e) => e.code === 'HOW_PAGE_TEXT');
  assert.throws(() => H().assertPageText('<main><p>one..</p></main>'), (e) => e.code === 'HOW_PAGE_TEXT');
});

test('AC-15 every trace link resolves, on the site, in the published tree or at the pinned commit', () => {
  const pick = oraclePick(), h = html(), q = pick.attempt.protocol;
  const line = read('scripts/build-public.sh').split('\n').find((l) => /EXCLUDE_RE=/.test(l));
  const exclude = new RegExp((/EXCLUDE_RE='([^']*)'/.exec(line) || /EXCLUDE_RE="([^"]*)"/.exec(line))[1]);
  for (const href of [`/r/${pick.receipt.receipt_hash}/`, '/reports/017/', '/' + suiteFile(pick).slice('docs/'.length)]) {
    assert.ok(h.includes(`href="${href}"`), href);
    assert.ok(fs.existsSync(path.join(ROOT, 'docs', href.endsWith('/') ? href + 'index.html' : href)), href);
  }
  for (const src of [pick.src, pick.src.replace(/\.json$/, '-answers.json')]) {
    assert.ok(h.includes(`href="https://github.com/driftproofhq/driftproof/blob/main/${src}"`), src);
    assert.ok(!exclude.test(src) && fs.existsSync(path.join(ROOT, src)), src);
  }
  assert.ok(h.includes(`href="https://github.com/${q.repository}/blob/${q.commit}/${q.skill_path}"`));
});

// The site's plain words for one task's state (spec 125 C-3), as Report 013's builder holds them.
const PLAIN013 = (() => { const src = read('scripts/prepare-report-013.js'); const block = /const PLAIN = \{([\s\S]*?)\};/.exec(src)[1]; return Object.fromEntries([...block.matchAll(/'?([a-z-]+)'?:\s*'([^']+)'/g)].map((m) => [m[1], m[2]])); })();
const deciders = (cases, up) => cases.filter((c) => c.state === (up ? 'separated-up' : 'separated-down')).map((c) => c.id);
test('AC-16 each task\'s averages and states, and the tasks that decided each reading', () => {
  const r = oraclePick().receipt, h = html();
  const W = H().STATE_WORDS;
  for (const k of ['separated-up', 'separated-down', 'underpowered']) assert.equal(W[k], PLAIN013[k], k);
  assert.equal(W['not-separated'], PLAIN013['no-separation']);
  const v = receiptVerdict(r), pr = placeboReading(r), n3 = (x) => x.toFixed(3);
  for (const c of v.cases) {
    const li = element(h, `data-task="${c.id}"`); assert.ok(li, c.id);
    const t = text(li), p = pr.cases.find((x) => x.id === c.id);
    for (const mode of MODES) assert.ok(t.includes(n3(armOf(rowOf(r, c.id, mode)).mean)), `${c.id} ${mode}`);
    assert.ok(t.includes(W[c.state]) && t.includes(W[p.state]), c.id);
  }
  const want = { verdict: v.verdict === 'PASSED' ? deciders(v.cases, true) : v.verdict === 'REGRESSED' ? deciders(v.cases, false) : null,
    placebo: pr.reading === 'ABOVE_PLACEBO' ? deciders(pr.cases, true) : pr.reading === 'BELOW_PLACEBO' ? deciders(pr.cases, false) : null };
  const named = (which, page) => { const e = elementOf(page, `data-deciding="${which}"`); return e ? attrOf(e.attrs, 'data-tasks').split(' ').filter(Boolean) : null; };
  // Review fix 1, M1: each deciding task carries its own averages, read here from the receipt's rows.
  const other = { verdict: 'baseline', placebo: 'placebo' };
  for (const which of ['verdict', 'placebo']) {
    if (!want[which]) continue;
    assert.deepEqual(named(which, h), want[which], which);
    const t = text(elementOf(h, `data-deciding="${which}"`).inner);
    for (const id of want[which]) {
      assert.ok(t.includes(id));
      assert.ok(t.includes(`${n3(armOf(rowOf(r, id, 'with_skill')).mean)} with the skill, ${n3(armOf(rowOf(r, id, other[which])).mean)}`), `${which}: ${t}`);
    }
  }
  assert.ok(text(elementOf(h, 'data-deciding="verdict"').inner).endsWith('decided it: 0.738 with the skill, 0.930 without.'));
  assert.deepEqual(want.verdict, ['privacy']);
  const moved = h.replace(/data-deciding="verdict" data-tasks="[^"]*"/, 'data-deciding="verdict" data-tasks="resume"');
  assert.notDeepEqual(named('verdict', moved), want.verdict);
});

test('AC-17 the reading carries its scope', () => {
  const pick = oraclePick(), r = pick.receipt;
  // Review fix 1, m3: screen one says who wrote the task.
  assert.ok(text(steps(html())[0].html).includes('a task Driftproof wrote to test the skill'));
  const scope = text(element(html(), 'data-scope') || '');
  const need = [`${r.suite.case_count} tasks`, 'written by Driftproof', 'text only', 'tools forbidden', humanModelName(r.run.model_id), humanModelName(r.run.judge.model_id), dateOf(r)];
  assert.deepEqual(need.filter((n) => !scope.includes(n)), []);
  // A suite whose first task lacks the no-tools sentence, pinned and sealed as the real one: refused.
  const suite = suiteOf(pick);
  suite.cases[0].prompt = suite.cases[0].prompt.replace(/^Do not use tools[^.]*\.\s*/, '');
  const bytes = Buffer.from(JSON.stringify(suite, null, 2) + '\n');
  const sealed = planted((x) => { x.suite.suite_hash = suiteIdentity(suite).suiteHash; }, { attempt: (a) => { a.protocol.evals_sha256 = sha(bytes); a.protocol.suite_hash = suiteIdentity(suite).suiteHash; return a; } });
  const answers = answersOf(pick); answers.receipt_hash = sealed.rows.find((x) => x.attempt_id === pick.attempt_id).receipt.receipt_hash;
  assert.throws(() => H().exampleOf({ campaign: sealed, suiteBytes: bytes, answers }), (e) => e.code === 'HOW_SCOPE');
});

test('AC-10, AC-11 Chromium: one screen at a time with script, all five without, no request, both widths', { timeout: 300000 }, async (t) => {
  const { chromium } = require('playwright');
  const shots = scratch('how-it-works-shots-');
  const server = http.createServer((req, res) => {
    let file = path.resolve(ROOT, 'docs', '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    if (!file.startsWith(path.join(ROOT, 'docs') + path.sep)) return res.writeHead(403).end();
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
    const url = 'http://127.0.0.1:' + server.address().port + '/how-it-works/';
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const requests = [];
    await context.route('**/*', async (route) => {
      requests.push(route.request().url());
      if (new URL(route.request().url()).hostname === '127.0.0.1') await route.continue(); else await route.abort();
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-how-nav]');
    // The site-wide beacon is the one request to another host; every other is one of the page's own files.
    for (const u of requests) {
      const at = new URL(u);
      assert.ok(u === 'https://static.cloudflareinsights.com/beacon.min.js' || (at.hostname === '127.0.0.1' && fs.existsSync(path.join(ROOT, 'docs', decodeURIComponent(at.pathname)))), u);
    }
    const loaded = requests.length;
    const state = () => page.evaluate(() => ({ url: location.href, cookie: document.cookie, local: Object.entries(localStorage), session: Object.entries(sessionStorage) }));
    const before = await state();
    const visible = () => page.evaluate(() => [...document.querySelectorAll('section[data-step]')].filter((s) => !s.hidden && s.offsetParent !== null).map((s) => +s.dataset.step));
    const counter = () => page.locator('[data-how-count]').textContent();
    const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
    assert.deepEqual(await visible(), [1]);
    assert.equal((await counter()).trim(), 'Step 1 of 5');
    assert.ok(await page.locator('[data-how-back]').isDisabled());
    await page.screenshot({ path: path.join(shots, 'desktop-step-1.png'), fullPage: true });
    for (let n = 2; n <= 5; n++) {
      await page.locator('[data-how-next]').click();
      assert.deepEqual(await visible(), [n]);
      assert.equal((await counter()).trim(), `Step ${n} of 5`);
      assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.closest('section[data-step]') && document.activeElement.tagName), 'H2');
      assert.equal(await page.evaluate(() => +document.activeElement.closest('section[data-step]').dataset.step), n);
      await page.screenshot({ path: path.join(shots, `desktop-step-${n}.png`), fullPage: true });
    }
    assert.ok(await page.locator('[data-how-next]').isDisabled());
    // Review fix 1, M2: each "On this page" link shows its screen, brings its heading into view and
    // leaves the address as it was, so no fragment is written.
    const toc = page.locator('nav.page-toc a[href^="#step-"]');
    assert.equal(await toc.count(), 5);
    for (const n of [2, 5, 1, 3, 4]) {
      await page.locator(`nav.page-toc a[href="#step-${n}-title"]`).click();
      assert.deepEqual(await visible(), [n], `link to step ${n}`);
      assert.equal(page.url(), url, `link to step ${n} leaves the address`);
      assert.equal((await counter()).trim(), `Step ${n} of 5`);
      const top = await page.evaluate((k) => document.getElementById(`step-${k}-title`).getBoundingClientRect().top, n);
      // Two pixels for sub-pixel layout: scrollIntoView lands the heading at -0.3 at 1280 wide.
      assert.ok(top > -2 && top < 900, `step ${n} heading in view (${top})`);
    }
    await page.screenshot({ path: path.join(shots, 'desktop-toc-step-4.png'), fullPage: false });
    assert.deepEqual(await visible(), [4]);
    await page.setViewportSize({ width: 390, height: 844 });
    for (let n = 4; n >= 1; n--) {
      assert.ok(await fits(), `390 wide, step ${n}`);
      await page.screenshot({ path: path.join(shots, `mobile-step-${n}.png`), fullPage: true });
      if (n > 1) await page.locator('[data-how-back]').click();
    }
    assert.equal(requests.length, loaded, 'stepping makes no request');
    assert.deepEqual(await state(), before, 'stepping writes nothing');
    await page.evaluate(() => fetch('/privacy-plant').catch(() => {}));
    assert.ok(requests.length > loaded, 'the observer sees a planted request');
    await page.evaluate(() => localStorage.setItem('privacy-plant', 'seen'));
    assert.notDeepEqual(await state(), before, 'the observer sees a planted write');
    await context.close();
    for (const [width, name] of [[1280, 'desktop'], [390, 'mobile']]) {
      const nojs = await browser.newContext({ javaScriptEnabled: false, viewport: { width, height: 900 } });
      const p = await nojs.newPage();
      await p.goto(url);
      assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll('section[data-step]')].filter((s) => s.offsetParent !== null).map((s) => +s.dataset.step)), [1, 2, 3, 4, 5]);
      assert.equal(await p.locator('[data-how-nav]').count(), 0);
      assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `no script, ${width} wide`);
      await p.screenshot({ path: path.join(shots, `${name}-no-script.png`), fullPage: true });
      await nojs.close();
    }
    t.diagnostic('screenshots: ' + shots);
  } finally { if (browser) await browser.close(); await new Promise((resolve) => server.close(resolve)); }
});
