// SPDX-License-Identifier: Apache-2.0
'use strict';
// Issue 688 (spec 688): /sugar-pill/, pick what you want help with and see what each skill did. The
// oracle below is its own: it reads the receipts each report lists in docs/data/reports.json, checks
// their seals and computes every word and figure with lib/plain.js and lib/verdict.js, so it never
// asks the page builder what the page should say. Each plant edits a page copy and turns the oracle
// red for its own criterion. Nothing here writes inside the tree.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { createHash } = require('node:crypto');
const { plainOf } = require('../lib/plain');
const { placeboReading, placeboLine, receiptVerdict, armOf, CASES_LINE } = require('../lib/verdict');
const { verifyReceiptHash, repositoryJudgeRelationship } = require('../lib/receipt');
const policy = require('../lib/report-015-publication');
const { humanModelName } = require('../scripts/model-names');
const { htmlToText } = require('../scripts/html-text.js');

const ROOT = path.resolve(__dirname, '..');
const REL = 'sugar-pill/index.html';
const PAGE = 'docs/' + REL;
const URL_PATH = '/sugar-pill/';
const SKILLS = 'specs/640-how-it-works/skills';
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const json = (f) => JSON.parse(read(f));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const scratch = (name) => fs.mkdtempSync(path.join(process.env.TMPDIR || '/var/tmp', name));
const builder = () => require('../scripts/sugar-pill-page.js');
const lexicon = import(pathToFileURL(path.join(ROOT, 'specs/031-artefact-claims/probes/bands.mjs')).href).then((m) => m.LEXICON);
// The plain words spec 669 gives each placebo token (A-669-3), the spec's own copy.
const PLAIN = { ABOVE_PLACEBO: 'beat the fake', BELOW_PLACEBO: 'below the fake', NO_DIFFERENCE: 'no difference', INCONCLUSIVE: 'inconclusive', UNDERPOWERED: 'too few answers to tell', NOT_MEASURED: 'not measured' };
// The page's one plain sentence per reading against the fake (A-688-1), the spec's own copy; the
// UNDERPOWERED reading has two, told apart by the reader's line naming the cases.
const FAKE_SENTENCE = {
  ABOVE_PLACEBO: 'On at least one task it scored above the fake, and on none below.',
  BELOW_PLACEBO: 'On at least one task it scored below the fake.',
  NO_DIFFERENCE: 'On no task did it score clearly above or below the fake, with enough answers to have seen a gap.',
  INCONCLUSIVE: 'Some answers were lost, so the comparison with the fake shows no direction.',
  UNDERPOWERED: 'There were too few answers, or they varied too much, to tell it from the fake.',
  UNDERPOWERED_CASES: 'The tasks scored too far apart from each other to tell it from the fake, and more answers are not expected to change that.',
  NOT_MEASURED: 'This run did not measure it against the fake.',
};
const fakeSentence = (token, line) => FAKE_SENTENCE[token === 'UNDERPOWERED' && line.includes(CASES_LINE) ? 'UNDERPOWERED_CASES' : token];
// The sentence against nothing as the card shows it: the label once, then the rest (A-688-1).
const shownSentence = (label, sentence) => (sentence.startsWith(`${label}:`) ? sentence.slice(label.length + 1).trim().replace(/^[a-z]/, (c) => c.toUpperCase()) : sentence);
const TOKENS = /\b(?:ABOVE_PLACEBO|BELOW_PLACEBO|NO_DIFFERENCE|INCONCLUSIVE|UNDERPOWERED|NOT_MEASURED|PASSED|REGRESSED|NO_EFFECT)\b/;
const LIMITATION = repositoryJudgeRelationship('claude-haiku-5-5', 'claude-haiku-5-5').limitation;
const REPORTS = ['017', '018'];

const decode = (s) => s.replace(/&(lt|gt|quot|#39|amp);/g, (m, k) => ({ lt: '<', gt: '>', quot: '"', '#39': "'", amp: '&' })[k]);
const text = (h) => htmlToText(h, { skip: ['script', 'style'], skipText: ' ', tagText: ' ', commentText: ' ', decode, collapse: true }).replace(/\s+([.,;:!?])/g, '$1').trim();
const html = () => read(PAGE);
const mainOf = (h) => h.slice(h.indexOf('<main'), h.lastIndexOf('</main>') + 7);
// Elements by a balanced open and close tag, read with their attributes and inner HTML.
function elements(h, tag, attrRe) {
  const out = [];
  const re = new RegExp(`<${tag}\\b([^>]*)>`, 'g');
  let m;
  while ((m = re.exec(h))) {
    if (attrRe && !attrRe.test(m[1])) continue;
    let depth = 1, at = re.lastIndex;
    const step = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'g');
    step.lastIndex = at;
    let s;
    while ((s = step.exec(h))) { depth += s[1] ? -1 : 1; if (!depth) break; }
    out.push({ attrs: m[1], inner: h.slice(at, s ? s.index : h.length), outer: h.slice(m.index, s ? step.lastIndex : h.length), at: m.index });
  }
  return out;
}
const attr = (attrs, name) => { const m = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs); return m ? decode(m[1]) : null; };
// A quoted element is replaced by a placeholder word, so the punctuation around it stays where it was.
const without = (h, kind) => h.replace(/<(\w+)\b[^>]*\bdata-quote="([a-z]+)"[^>]*>[\s\S]*?<\/\1>/g, (m, tag, k) => (k === kind ? ' quoted ' : m));

// ── the oracle: the receipts each report lists, read by the test itself ─────────────────────────
let cached = null;
function receipts() {
  if (cached) return cached;
  const rows = json('docs/data/reports.json').reports;
  cached = [];
  for (const n of REPORTS) {
    const row = rows.find((r) => r.number.value === n);
    assert.ok(row, `Report ${n} is in reports.json`);
    for (const p of row.receipt_paths) {
      const receipt = json(p.value);
      assert.ok(verifyReceiptHash(receipt), p.value);
      const pr = placeboReading(receipt), v = receiptVerdict(receipt), router = policy.routerLimit(receipt);
      const arm = (id, mode) => armOf(receipt.results.cases.find((c) => c.id === id && c.mode === mode));
      const tasks = v.cases.map((c) => ({ id: c.id, skill: arm(c.id, 'with_skill'), fake: arm(c.id, 'placebo'), none: arm(c.id, 'baseline') }));
      cached.push({ report: n, src: p.value, receipt, hash: receipt.receipt_hash, skill: receipt.skill.name, model: receipt.run.model_id, placebo: pr.reading, line: placeboLine(pr), plain: plainOf(receipt), verdict: v.verdict, router: !!router, tasks });
    }
  }
  return cached;
}
const cardsOf = (h) => elements(h, 'section', /class="pill-measure/).map((e) => ({ ...e, hash: attr(e.attrs, 'data-receipt'), report: attr(e.attrs, 'data-report') }));

// What the oracle holds a card to, as a list of problems; empty when the card reads right.
function problemsOf(card, all = receipts()) {
  const o = all.find((x) => x.hash === card.hash);
  if (!o) return [`no listed receipt has hash ${card.hash}`];
  const out = [], t = text(card.inner), inner = card.inner;
  if (card.report !== o.report) out.push('report');
  const fake = elements(inner, 'p', /class="pill-reading pill-fake/)[0];
  if (!fake) out.push('no reading against the fake');
  else {
    const ft = text(fake.inner);
    if (attr(fake.attrs, 'data-reading') !== o.placebo) out.push('placebo token attribute');
    if (attr(fake.attrs, 'data-line') !== o.line) out.push('placebo line attribute');
    if (!ft.includes(PLAIN[o.placebo])) out.push('plain words against the fake');
    if (!ft.includes(fakeSentence(o.placebo, o.line))) out.push('plain sentence against the fake');
    if (TOKENS.test(ft) || /case rule/i.test(ft) || ft.includes(o.line)) out.push('rule wording visible against the fake');
    if (o.router !== /a router, left out of the headline count/.test(ft)) out.push('router note against the fake');
  }
  const none = elements(inner, 'p', /class="pill-reading pill-none/)[0];
  if (!none) out.push('no reading against nothing');
  else if (o.router) {
    if (!text(none.inner).includes(policy.LABEL) || !text(none.inner).includes(policy.REASON) || !none.inner.includes(`href="${policy.AMENDMENT}"`)) out.push('router label against nothing');
    if (text(none.inner).includes(o.plain.sentence)) out.push('a router card carries a skill verdict');
  } else {
    const nt = text(none.inner);
    if (!nt.includes(`${o.plain.label}.`) || !nt.includes(shownSentence(o.plain.label, o.plain.sentence))) out.push('words against nothing');
    if (nt.split(o.plain.label).length !== 2) out.push('the label printed twice');
    if (attr(none.attrs, 'data-sentence') !== o.plain.sentence) out.push('sentence attribute');
    if (attr(none.attrs, 'data-verdict') !== o.verdict) out.push('verdict attribute');
    if (TOKENS.test(nt)) out.push('rule wording visible against nothing');
  }
  // The figures: each task's three arms, mean and spread, in data elements naming the receipt.
  const rows = elements(inner, 'tr', /data-task=/);
  if (rows.length !== o.tasks.length) out.push(`task rows ${rows.length} of ${o.tasks.length}`);
  for (const task of o.tasks) {
    const r = rows.find((x) => attr(x.attrs, 'data-task') === task.id);
    if (!r) { out.push(`task ${task.id} missing`); continue; }
    for (const [mode, a] of [['with_skill', task.skill], ['placebo', task.fake], ['baseline', task.none]]) {
      const cell = elements(r.inner, 'td', new RegExp(`data-arm="${mode}"`))[0];
      if (!cell) { out.push(`${task.id} ${mode} cell`); continue; }
      const data = [...cell.inner.matchAll(/<data\b([^>]*)>([^<]*)<\/data>/g)].map((m) => ({ value: attr(m[1], 'value'), src: attr(m[1], 'data-src'), shown: m[2] }));
      if (!a) { if (data.length) out.push(`${task.id} ${mode} has figures for an unread arm`); continue; }
      const want = [a.mean, a.sd];
      if (data.length !== 2) { out.push(`${task.id} ${mode} figures ${data.length}`); continue; }
      data.forEach((d, i) => {
        if (Number(d.value) !== want[i]) out.push(`${task.id} ${mode} value ${d.value} is not ${want[i]}`);
        if (d.shown !== want[i].toFixed(3)) out.push(`${task.id} ${mode} shows ${d.shown}`);
        if (d.src !== o.src) out.push(`${task.id} ${mode} names ${d.src}`);
      });
    }
  }
  // The caveats, the report's own points but the finding.
  const summary = json('docs/data/report-summaries.json').reports[o.report].points.filter((p) => p.lead !== 'What we found.');
  for (const p of summary) {
    const li = elements(inner, 'li', new RegExp(`data-lead="${p.lead.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/'/g, '&#39;')}"`))[0];
    if (!li) { out.push(`caveat missing: ${p.lead}`); continue; }
    if (text(li.inner) !== `${p.lead} ${p.text}`.replace(/\s+/g, ' ').trim()) out.push(`caveat reworded: ${p.lead}`);
  }
  if (o.report === '018' && !t.includes(LIMITATION)) out.push('the limitation');
  if (!inner.includes(`href="/reports/${o.report}/"`)) out.push('report link');
  if (!inner.includes(`href="/r/${o.hash}/"`)) out.push('receipt link');
  if (!t.includes(humanModelName(o.model))) out.push('model name');
  return out;
}

// The numerals the page may carry outside a data element: human model names, report numbers, the
// amendment's number and a time element. Everything else is a typed figure.
function typedFigures(h) {
  let m = mainOf(h).replace(/<data\b[^>]*>[\s\S]*?<\/data>/g, ' ').replace(/<time\b[^>]*>[\s\S]*?<\/time>/g, ' ').replace(/<svg\b[\s\S]*?<\/svg>/g, ' ').replace(/<code\b[^>]*>[\s\S]*?<\/code>/g, ' ');
  m = without(m, 'text');
  let t = text(m);
  for (const id of new Set(receipts().map((x) => x.model))) t = t.split(humanModelName(id)).join(' ');
  t = t.replace(/\bReport 0\d\d\b/g, ' ').replace(/\bAmendment 1\b/g, ' ');
  return [...t.matchAll(/\S*\d\S*/g)].map((x) => x[0]);
}
const ownWords = (h) => text(without(without(mainOf(h), 'text'), 'library'));

test('AC-1 every card reads its own sealed receipt in the library\'s words, with the receipt\'s figures', () => {
  const all = receipts();
  assert.equal(all.length, 40, 'twenty skills on two models');
  const cards = cardsOf(html());
  assert.equal(cards.length, all.length);
  for (const c of cards) assert.deepEqual(problemsOf(c), [], `${c.report} ${c.hash.slice(0, 8)}`);
  assert.deepEqual(new Set(cards.map((c) => c.hash)).size, all.length, 'each receipt once');
  // Plants: a reading retyped; a figure one thousandth up; two cards' hashes swapped.
  const h = html();
  const helped = cards.find((c) => /data-verdict="PASSED"/.test(c.inner) && /data-reading="ABOVE_PLACEBO"/.test(c.inner));
  const retyped = { ...helped, inner: helped.inner.replace('beat the fake', 'below the fake') };
  assert.ok(problemsOf(retyped).includes('plain words against the fake'));
  const relabelled = { ...helped, inner: helped.inner.replace('Clearly helped', 'Clearly hurt') };
  assert.ok(problemsOf(relabelled).includes('words against nothing'));
  const firstData = /<data value="([^"]+)"/.exec(helped.inner)[1];
  const up = { ...helped, inner: helped.inner.replace(`<data value="${firstData}"`, `<data value="${(Number(firstData) + 0.001).toFixed(6)}"`) };
  assert.ok(problemsOf(up).some((p) => /value .* is not/.test(p)));
  const [a, b] = cards;
  assert.ok(problemsOf({ ...a, hash: b.hash }).length > 0 && problemsOf({ ...b, hash: a.hash }).length > 0, 'swapped hashes read red');
  // A-688-1 plants: a token made visible, the reader's line made visible, the label printed twice.
  const o = all.find((x) => x.hash === helped.hash);
  assert.ok(problemsOf({ ...helped, inner: helped.inner.replace('<strong>beat the fake</strong>', '<strong>beat the fake</strong> <code>ABOVE_PLACEBO</code>') }).includes('rule wording visible against the fake'));
  assert.ok(problemsOf({ ...helped, inner: helped.inner.replace(FAKE_SENTENCE.ABOVE_PLACEBO, o.line) }).includes('rule wording visible against the fake'));
  const twice = cards.find((c) => /data-verdict="UNDERPOWERED"/.test(c.inner));
  const ot = all.find((x) => x.hash === twice.hash);
  assert.ok(problemsOf({ ...twice, inner: twice.inner.replace(`${ot.plain.label}</strong>. `, `${ot.plain.label}</strong>. ${ot.plain.label}: `) }).includes('the label printed twice'));
  // No token and no rule wording is visible anywhere on the page.
  const visible = text(mainOf(h));
  assert.ok(!TOKENS.test(visible) && !/case rule/i.test(visible), visible.match(/.{0,40}(?:case rule|[A-Z]{4,}_[A-Z]+).{0,40}/i)?.[0]);
  assert.ok(h.includes('data-island="sugar-pill"'));
});

test('AC-2 each card carries its report\'s caveats, verbatim, and Report 018\'s limitation is the library\'s', () => {
  const cards = cardsOf(html());
  for (const c of cards.filter((x) => x.report === '018')) {
    assert.ok(text(c.inner).includes(LIMITATION), c.hash.slice(0, 8));
    assert.ok(text(c.inner).includes('Where the fake scored below no skill, beating it does not mean beating no skill'));
    assert.ok(/three text tasks each/.test(text(c.inner)));
  }
  for (const c of cards.filter((x) => x.report === '017')) assert.ok(text(c.inner).includes('Where the fake scored below no skill, beating it does not mean beating no skill'), c.hash.slice(0, 8));
  const c = cards.find((x) => x.report === '018');
  const gone = { ...c, inner: c.inner.replace(/<li data-lead="Beating the fake is not beating no skill\."[\s\S]*?<\/li>/, '') };
  assert.ok(problemsOf(gone).some((p) => /caveat missing/.test(p)));
  const reworded = { ...c, inner: c.inner.replace('Self-grading may favor', 'Self-grading does not favor') };
  assert.ok(problemsOf(reworded).some((p) => /caveat reworded|the limitation/.test(p)));
});

test('AC-3 no typed figure, and no new verdict, ranking or score word', () => {
  const h = html();
  assert.deepEqual(typedFigures(h), []);
  assert.deepEqual(typedFigures(h.replace('</h1>', '</h1><p>12 of 16 skills beat the fake.</p>')), ['12', '16']);
  const own = ownWords(h).toLowerCase();
  for (const w of ['best skill', 'the best', 'top skill', 'ranked', 'ranking', 'winner', 'leaderboard', 'score of']) assert.ok(!own.includes(w), w);
  assert.ok(ownWords(h.replace('</h1>', '</h1><p>The best skill is tdd.</p>')).toLowerCase().includes('best skill'), 'the plant is seen');
});

test('AC-4 alphabetical within a chip, each measured skill in one chip, and the grouping said to be navigation', () => {
  const h = html();
  const groups = elements(mainOf(h), 'section', /class="pill-group"/);
  assert.ok(groups.length >= 3);
  const seen = [];
  for (const g of groups) {
    const names = elements(g.inner, 'details', /class="pill-card/).map((e) => attr(e.attrs, 'data-skill'));
    assert.ok(names.length > 0, attr(g.attrs, 'id'));
    assert.deepEqual(names, [...names].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())), attr(g.attrs, 'id'));
    const id = attr(g.attrs, 'id');
    assert.ok(h.includes(`href="#${id}"`), `a chip links ${id}`);
    seen.push(...names);
  }
  const measured = [...new Set(receipts().map((x) => x.skill))].sort();
  assert.deepEqual([...seen].sort(), measured, 'every measured skill once');
  // Plant: two cards swapped so the order follows a reading, not the name.
  const g = groups.find((x) => elements(x.inner, 'details', /class="pill-card/).length >= 2);
  const cards = elements(g.inner, 'details', /class="pill-card/);
  const swapped = g.inner.replace(cards[0].outer, '\u0000').replace(cards[1].outer, cards[0].outer).replace('\u0000', cards[1].outer);
  const names = elements(swapped, 'details', /class="pill-card/).map((e) => attr(e.attrs, 'data-skill'));
  assert.notDeepEqual(names, [...names].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())));
  const note = elements(mainOf(h), 'p', /data-grouping-note/)[0];
  assert.ok(note && /not a finding/.test(text(note.inner)));
  assert.throws(() => builder().groupSkills([{ name: 'tdd' }], [{ id: 'x', label: 'X', skills: ['tdd', 'not-measured'] }]), (e) => e.code === 'GROUP_COVERAGE');
  assert.throws(() => builder().groupSkills([{ name: 'tdd' }, { name: 'triage' }], [{ id: 'x', label: 'X', skills: ['tdd'] }]), (e) => e.code === 'GROUP_COVERAGE');
  assert.throws(() => builder().groupSkills([{ name: 'tdd' }], [{ id: 'x', label: 'X', skills: ['tdd'] }, { id: 'y', label: 'Y', skills: ['tdd'] }]), (e) => e.code === 'GROUP_COVERAGE');
});

test('AC-5 each description is the pinned text\'s own, quoted', () => {
  const plan = json('receipts/report-017c/plan.json');
  const h = html();
  for (const a of plan.execution.attempts) {
    const bytes = fs.readFileSync(path.join(ROOT, SKILLS, a.attempt_id + '.md'));
    assert.equal(sha(bytes), a.protocol.skill_sha256, a.protocol.skill);
    const desc = builder().descriptionOf(bytes.toString('utf8'));
    assert.ok(desc.length > 0, a.protocol.skill);
    const card = elements(mainOf(h), 'details', new RegExp(`data-skill="${a.protocol.skill}"`))[0];
    assert.ok(card, a.protocol.skill);
    const quoted = elements(card.inner, 'span', /data-quote="text"/)[0];
    // A-688-2: the words are the description's; a literal "..." is set as the ellipsis character.
    assert.ok(quoted && text(quoted.inner) === desc.replace(/\.{3}/g, '…'), a.protocol.skill);
    assert.ok(!/\.\./.test(text(quoted.inner)), `${a.protocol.skill}: no doubled full stop in the shown description`);
  }
  assert.equal(builder().typography('a skill that can... do X. Really.'), 'a skill that can… do X. Really.');
  assert.equal(builder().typography('no ellipsis here.'), 'no ellipsis here.');
  // Plant: a shown description with the literal dots reads red under spec 020 AC-42's reading of the whole page.
  const page = text(mainOf(html()));
  assert.ok(!/\.\.| - /.test(page), page.match(/.{0,40}(\.\.| - ).{0,40}/)?.[0]);
  assert.ok(/\.\./.test(text(mainOf(html().replace('…', '...')))), 'the plant is seen');
  const dir = scratch('sugar-pill-skills-');
  for (const f of fs.readdirSync(path.join(ROOT, SKILLS))) fs.copyFileSync(path.join(ROOT, SKILLS, f), path.join(dir, f));
  fs.appendFileSync(path.join(dir, plan.execution.attempts[5].attempt_id + '.md'), ' ');
  assert.throws(() => builder().skillsOf({ skillsDir: dir }), (e) => e.code === 'SKILL_TEXT');
});

test('AC-6 routers show the router label and hand-offs carry their note', () => {
  const cards = cardsOf(html());
  const routers = receipts().filter((x) => x.router);
  assert.equal(routers.length, 8, 'four routers on two models');
  for (const o of routers) {
    const c = cards.find((x) => x.hash === o.hash);
    assert.ok(text(c.inner).includes(policy.LABEL) && !text(c.inner).includes(o.plain.sentence), o.skill);
    assert.ok(attr(c.attrs, 'data-router') === 'true');
    const relabelled = { ...c, inner: c.inner.replace(policy.LABEL, 'Clearly helped') };
    assert.ok(problemsOf(relabelled).includes('router label against nothing'));
  }
  const handoffs = receipts().filter((x) => ['grill-me', 'grill-with-docs'].includes(x.skill));
  assert.equal(handoffs.length, 4);
  for (const o of handoffs) {
    const c = cards.find((x) => x.hash === o.hash);
    assert.match(text(c.inner), /About grill-me and grill-with-docs: each skill's whole text is an instruction to call another skill/);
  }
});

test('AC-7 every link resolves, and the blind read is linked from the skill it has pairs for', () => {
  const h = html();
  const hrefs = [...mainOf(h).matchAll(/href="(\/[^"#]*)"/g)].map((m) => m[1]);
  for (const href of new Set(hrefs)) {
    const file = path.join(ROOT, 'docs', href.replace(/\/$/, '/index.html'));
    assert.ok(fs.existsSync(file), href);
  }
  const blind = elements(mainOf(h), 'details', /class="pill-card/).filter((c) => c.inner.includes('href="/reports/017/blind/"')).map((c) => attr(c.attrs, 'data-skill'));
  const P17 = require('../scripts/prepare-report-017.js');
  const pick = require('../scripts/build-report-017-blind.js').skillOf(P17.readCampaign({ campaignRoot: path.join(ROOT, P17.CAMPAIGN) }).rows, path.join(ROOT, P17.PANEL));
  assert.deepEqual(blind, fs.existsSync(path.join(ROOT, 'docs/reports/017/blind/index.html')) ? [pick.row.skill] : []);
});

test('AC-9 the committed page is the builder\'s: --check reads it current, and a changed byte reads stale', () => {
  const cli = (...args) => spawnSync(process.execPath, [path.join(ROOT, 'scripts/sugar-pill-page.js'), ...args], { cwd: ROOT, encoding: 'utf8', timeout: 600000 });
  const ok = cli('--check');
  assert.equal(ok.status, 0, ok.stderr);
  const dir = scratch('sugar-pill-check-');
  fs.mkdirSync(path.join(dir, 'sugar-pill'));
  fs.copyFileSync(path.join(ROOT, PAGE), path.join(dir, REL));
  assert.equal(cli('--check', '--docs', dir).status, 0);
  fs.writeFileSync(path.join(dir, REL), read(PAGE).replace('<h1>', '<h1 data-plant="">'));
  assert.equal(cli('--check', '--docs', dir).status, 1);
  const site = spawnSync(process.execPath, [path.join(ROOT, 'scripts/build-site-pages.js'), '--check'], { cwd: ROOT, encoding: 'utf8', timeout: 600000 });
  assert.equal(site.status, 0, site.stderr);
});

test('AC-10 the reports index links the page', () => {
  assert.ok(read('docs/reports/index.html').includes(`href="${URL_PATH}"`));
});

test('AC-11 the page\'s own words: no doubled full stop, spaced hyphen, band lexicon or chance claim', async () => {
  const h = html();
  const own = ownWords(h);
  assert.ok(!/\.\.| - /.test(own), own.match(/.{0,40}(\.\.| - ).{0,40}/)?.[0]);
  const whole = text(mainOf(h));
  for (const { cls, re } of await lexicon) assert.ok(!re.test(whole), cls);
  for (const w of ['significant', 'statistically', 'proves', 'confidence', 'by more than chance']) assert.ok(!own.toLowerCase().includes(w), w);
  assert.ok(ownWords(h.replace('</h1>', '</h1><p>It beat the fake by more than chance.</p>')).includes('by more than chance'));
  // The description the head carries is the page's first paragraph, whole.
  const desc = /<meta name="description" content="([^"]*)">/.exec(h)[1];
  assert.ok(decode(desc).length >= 50 && decode(desc).length <= 155);
});

test('AC-8 Chromium: chips filter, search finds, keyboard works, no script shows all, nothing moves under reduced motion, both widths', { timeout: 300000 }, async (t) => {
  const { chromium } = require('playwright');
  const shots = scratch('sugar-pill-shots-');
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
  const island = read('docs/islands/sugar-pill.js');
  for (const bad of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'sendBeacon', 'import(', 'localStorage', 'sessionStorage', 'document.cookie', 'innerHTML', 'location.href =', 'history.']) assert.ok(!island.includes(bad), bad);
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const url = 'http://127.0.0.1:' + server.address().port + URL_PATH;
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const requests = [];
    await context.route('**/*', async (route) => {
      requests.push(route.request().url());
      if (new URL(route.request().url()).hostname === '127.0.0.1') await route.continue(); else await route.abort();
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-island="sugar-pill"][data-mounted]');
    for (const u of requests) {
      const at = new URL(u);
      assert.ok(u === 'https://static.cloudflareinsights.com/beacon.min.js' || (at.hostname === '127.0.0.1' && fs.existsSync(path.join(ROOT, 'docs', decodeURIComponent(at.pathname)))), u);
    }
    const loaded = requests.length;
    const state = () => page.evaluate(() => ({ url: location.href, cookie: document.cookie, local: Object.entries(localStorage), session: Object.entries(sessionStorage) }));
    const before = await state();
    const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
    const visibleCards = () => page.evaluate(() => [...document.querySelectorAll('details.pill-card')].filter((d) => d.offsetParent !== null).map((d) => d.dataset.skill));
    const total = await page.evaluate(() => document.querySelectorAll('details.pill-card').length);
    assert.equal((await visibleCards()).length, total, 'every card shows before a pick');
    const chips = page.locator('.pill-chipbar button');
    assert.ok((await chips.count()) >= 4);
    assert.equal(await page.locator('.pill-chipbar button[aria-pressed="true"]').count(), 1);
    assert.equal(await page.locator('nav.pill-chips a').count(), 0, 'the anchors became buttons');
    await page.screenshot({ path: path.join(shots, 'desktop-start.png'), fullPage: true });
    // A chip by keyboard: focus it and press Enter; only its group's cards stay.
    const second = chips.nth(2);
    await second.focus();
    await page.keyboard.press('Enter');
    assert.equal(await second.getAttribute('aria-pressed'), 'true');
    const group = await second.getAttribute('data-group');
    const inGroup = await page.evaluate((g) => [...document.querySelectorAll(`#${g} details.pill-card`)].map((d) => d.dataset.skill), group);
    assert.deepEqual(await visibleCards(), inGroup);
    assert.ok(inGroup.length > 0 && inGroup.length < total);
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.tagName), 'BUTTON', 'focus stays on the chip');
    await page.screenshot({ path: path.join(shots, 'desktop-chip.png'), fullPage: true });
    // The search, by keyboard: typing a name leaves that card, open.
    await chips.first().focus();
    await page.keyboard.press('Enter');
    const search = page.locator('input[type="search"]');
    assert.equal(await page.evaluate(() => document.querySelector('label:has(input[type="search"])')?.textContent.trim()), 'Find a skill by name');
    await search.focus();
    await page.keyboard.type('tdd');
    assert.deepEqual(await visibleCards(), ['tdd']);
    assert.ok(await page.evaluate(() => document.querySelector('details.pill-card[data-skill="tdd"]').open), 'the one card left opens');
    assert.equal(await page.locator('.pill-status').count(), 1);
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(shots, 'desktop-card.png'), fullPage: true });
    await page.keyboard.press('Escape');
    assert.equal(await search.inputValue(), '');
    assert.equal((await visibleCards()).length, total);
    // A card by keyboard: Tab to a summary and press Enter; it opens and its bars grow.
    await search.focus();
    await page.keyboard.type('triage');
    assert.deepEqual(await visibleCards(), ['triage']);
    await page.waitForTimeout(900);
    const grown = await page.evaluate(() => [...document.querySelectorAll('details.pill-card[data-skill="triage"] svg.pill-bar rect')].map((r) => getComputedStyle(r).transform));
    assert.ok(grown.length > 0 && grown.every((x) => x === 'none' || /matrix\(1,/.test(x)), 'bars are at full width once drawn');
    assert.equal(requests.length, loaded, 'picking and searching make no request');
    assert.deepEqual(await state(), before, 'picking and searching write nothing');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(200);
    assert.ok(await fits(), '390 wide, a card open');
    await page.screenshot({ path: path.join(shots, 'mobile-card.png'), fullPage: true });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    assert.ok(await fits(), '390 wide, the list');
    await page.screenshot({ path: path.join(shots, 'mobile-start.png'), fullPage: true });
    await context.close();
    // Reduced motion: a card opens and nothing animates.
    const still = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
    const p2 = await still.newPage();
    await p2.goto(url);
    await p2.waitForSelector('[data-island="sugar-pill"][data-mounted]');
    await p2.evaluate(() => { document.querySelector('details.pill-card[data-skill="tdd"]').open = true; });
    await p2.waitForTimeout(150);
    assert.equal(await p2.evaluate(() => document.getAnimations().length), 0, 'nothing moves under reduced motion');
    const motion = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'no-preference' });
    const p3 = await motion.newPage();
    await p3.goto(url);
    await p3.waitForSelector('[data-island="sugar-pill"][data-mounted]');
    await p3.evaluate(() => { document.querySelector('details.pill-card[data-skill="tdd"]').open = true; });
    await p3.waitForTimeout(150);
    assert.ok((await p3.evaluate(() => document.getAnimations().length)) > 0, 'with motion allowed, the card animates in');
    await still.close(); await motion.close();
    // Without script: every card is on the page, closed, the chips are links, and nothing scrolls sideways.
    for (const [width, name] of [[1280, 'desktop'], [390, 'mobile']]) {
      const nojs = await browser.newContext({ javaScriptEnabled: false, viewport: { width, height: 900 } });
      const p = await nojs.newPage();
      await p.goto(url);
      assert.equal(await p.evaluate(() => document.querySelectorAll('details.pill-card').length), total);
      assert.equal(await p.evaluate(() => document.querySelectorAll('details.pill-card[open]').length), 0);
      assert.equal(await p.evaluate(() => [...document.querySelectorAll('details.pill-card')].filter((d) => d.offsetParent !== null).length), total);
      assert.ok((await p.locator('nav.pill-chips a').count()) >= 4);
      assert.equal(await p.locator('.pill-chipbar').count(), 0);
      assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `no script, ${width} wide`);
      await p.screenshot({ path: path.join(shots, `${name}-no-script.png`), fullPage: true });
      await nojs.close();
    }
    t.diagnostic('screenshots: ' + shots);
  } finally { if (browser) await browser.close(); await new Promise((resolve) => server.close(resolve)); }
});
