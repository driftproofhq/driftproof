// SPDX-License-Identifier: Apache-2.0
'use strict';

// Unit tests for the escaper in lib/decision.js and the two surfaces that use it (spec 144): the job
// summary and the pull request comment.
//
//   node --test tests/markdown-escape.test.js
//
// The receipts are built in memory, draw by draw, as tests/plain.test.js builds them. The comment is
// posted by action/comment.js, run as the Action runs it, to a local double on 127.0.0.1 that records
// the body; no network and no credential are used, and the one token value the script insists on is an
// inert placeholder. The check that nothing live is left is written here and shares no code with the
// escaper: it removes each backslash pair and each code span, as CommonMark reads them, and looks for
// what remains. Issue 41 adds a second check, also written here: what GitHub links in the text a
// document renders to, once the escapes are gone (spec 144 A-144-3).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { acrossDraws } = require('../lib/sampling');
const { sealReceipt, ambiguityLine } = require('../lib/receipt');
const { UNDERPOWERED_LINE, CASES_LINE, lostDrawsLine, drawsLine, underpoweredLine } = require('../lib/verdict');
const decision = require('../lib/decision');
const plain = require('../lib/plain');

const { markdownText, markdownLost, markdownDraws } = decision;

// What a reader acts on once each escaped pair and each code span is gone (live(), below). From issue 41
// the escaper writes a code span around a word that holds a mention or a reference, so a code span is read
// as the text it is.
const LIVE_CHARS = /[`*~[\]<>&#@]/;
const AUTOLINK = /:\/\/|(^|[\s*_~(])www\./i;

test('every character a reader acts on is escaped, and what is left is text', () => {
  const cases = [
    ['a mention', '@octocat'],
    ['an email address', ['a', 'b.example'].join('@')],
    ['a reference', 'owner/repo#12 and #7'],
    ['a link', '[text](https://e.example/x)'],
    ['an image', '![alt](https://e.example/p.png)'],
    ['HTML', '<img src=x onerror=y> </sub> <!-- c -->'],
    ['an autolinked URL', 'see https://e.example/x and http://e.example'],
    ['a www address', 'www.e.example'],
    ['a character reference', '&#64; &amp; &lt;'],
    ['a code span', '`code` and ``more``'],
    ['emphasis', '*a* **b** ~~c~~ _d_ __e__'],
  ];
  for (const [what, input] of cases) {
    const out = markdownText(input);
    const left = live(out);
    assert.ok(!LIVE_CHARS.test(left), `${what}: ${JSON.stringify(out)} leaves ${JSON.stringify(left)}`);
    assert.ok(!AUTOLINK.test(left), `${what}: ${JSON.stringify(out)} leaves an autolink`);
    assert.ok(!/(^|[^A-Za-z0-9])_|_([^A-Za-z0-9]|$)/.test(left), `${what}: ${JSON.stringify(out)} leaves a flanking underscore`);
  }
});

test('cell() is the first half: a pipe, a backslash and a line break are as spec 111 left them', () => {
  assert.equal(markdownText('a|b'), 'a\\|b');
  assert.equal(markdownText('a\nb'), 'a b');
  assert.equal(markdownText('a\r\nb'), 'a b');
  assert.equal(markdownText('end\\'), 'end\\\\');
  // A backslash before an at sign is one escaped backslash and a code span holding the mention, never an
  // escape that leaves the at sign live (issue 41: GitHub reads a mention after a backslash escape).
  assert.equal(markdownText('\\@x'), '\\\\`@x`');
  assert.equal(markdownText(null), '');
  assert.equal(markdownText(undefined), '');
  assert.equal(markdownText(12), '12');
});

test('text this repository wrote passes through byte for byte', () => {
  const lost = [{ case: 'c1', with_skill: { lost: 1, drawn: 3, reasons: ['timeout', 'no reason recorded'] }, baseline: { lost: 2, drawn: 1, reasons: ['unreadable answer'] }, reasons: [] }];
  const same = [
    UNDERPOWERED_LINE,
    lostDrawsLine(lost),
    drawsLine({ reason: 'spread', case: 'c1', spread: 0.2 }),
    drawsLine({ reason: 'single_draw', case: 'c1' }),
    drawsLine({ reason: 'suite_band', cases: 3, band: 0.1, widened: true }),
    drawsLine({ reason: 'draws', value: 4, case: 'c1' }),
    drawsLine({ reason: 'lost_draws', lost }),
    // Spec 143's wording over the band rung's figures: no receipt text in it.
    CASES_LINE,
    underpoweredLine({ reason: 'suite_band', driver: 'cases' }),
    drawsLine({ reason: 'suite_band', cases: 3, band: 0.2, between: 0.1, driver: 'cases', widened: false }),
    drawsLine({ reason: 'suite_band', cases: 3, band: 0.2, between: 0.01, driver: 'draws', widened: false }),
    ambiguityLine([{ id: 'c1', mode: 'with_skill', rows: [0, 1] }]),
    'receipt unreadable (not valid JSON)',
    'no receipt for this model',
    '2 receipts for this model (a.json, b.json); none was read',
    'claude-haiku-4-5-20251001',
    'sk-claude-x-2026-09-17.json',
    'code-review-and-quality__claude-sonnet-5.json',
    'a_b_c and snake_case_id',
  ];
  for (const s of same) assert.equal(markdownText(s), s);
});

test('a GH- reference is put in a code span, and a hyphen elsewhere is not escaped', () => {
  assert.equal(markdownText('GH-12'), '`GH-12`');
  assert.equal(markdownText('see gh-3, GH-45.'), 'see `gh-3`, `GH-45.`');
  assert.equal(markdownText('aGH-4 GH-x gh- 5 GH_12'), 'aGH-4 GH-x gh- 5 GH_12');
  assert.equal(markdownText('case-1 and a-b-2'), 'case-1 and a-b-2');
});

test('a carriage return alone becomes a space, as a line feed does, and CRLF is as cell() left it', () => {
  assert.equal(markdownText('a\rb'), 'a b');
  assert.equal(markdownText('a\r\rb'), 'a  b');
  assert.equal(markdownText('a\r\nb'), 'a b');
  assert.ok(!/\r/.test(markdownText('- x\r    code\r---\rz')));
});

test('an underscore is text between two letters or digits and escaped where it could flank', () => {
  assert.equal(markdownText('a__b'), 'a__b');
  assert.equal(markdownText('a_b'), 'a_b');
  assert.equal(markdownText('_a_'), '\\_a\\_');
  assert.equal(markdownText('x _y_ z'), 'x \\_y\\_ z');
  assert.equal(markdownText('a_ b'), 'a\\_ b');
  assert.equal(markdownText('a __b'), 'a \\_\\_b');
});

test('the colon of a URL scheme and the dot of www. are the only places those characters are escaped', () => {
  assert.equal(markdownText('https://e.io'), 'https\\://e.io');
  assert.equal(markdownText('case: 1.5, v1.2 and a.b'), 'case: 1.5, v1.2 and a.b');
  assert.equal(markdownText('www.e.io'), 'www\\.e.io');
  assert.equal(markdownText('x www.e.io'), 'x www\\.e.io');
  assert.equal(markdownText('awww.e.io'), 'awww.e.io');
});

test('markdownCode: a backtick would end the span, a backslash does nothing there', () => {
  assert.equal(markdownCode('a`b'), "a'b");
  assert.equal(markdownCode('a|b'), 'a\\|b');
  assert.equal(markdownCode('a\nb'), 'a b');
  assert.equal(markdownCode('a\rb'), 'a b');
  assert.equal(markdownCode('@x [y](z)'), '@x [y](z)');
  function markdownCode(s) {
    // The helper is not exported (it is used only by summaryMarkdown); the Model cell is its caller.
    const d = { rows: [{ model: s, state: 'refused', delta: null, file: null, reason: 'r' }], receiptCount: 0, requestedCount: 1, worst: 'refused', unexpected: [] };
    const row = decision.summaryMarkdown(d).split('\n').find((l) => l.startsWith('| `'));
    return /^\| `(.*)` \| /.exec(row)[1];
  }
});

test('markdownLost and markdownDraws escape the case id and each reason, and nothing else', () => {
  const ugly = '@x [y](https://e.io) `z`';
  const lost = [{ case: ugly, with_skill: { lost: 1, drawn: 3, reasons: [ugly] }, baseline: null, reasons: [ugly] }];
  const frozen = JSON.stringify(lost);
  const out = markdownLost(lost);
  assert.equal(JSON.stringify(lost), frozen, 'the input is not changed');
  assert.equal(out[0].case, markdownText(ugly));
  assert.deepEqual(out[0].with_skill, { lost: 1, drawn: 3, reasons: [markdownText(ugly)] });
  assert.equal(out[0].baseline, null);
  assert.deepEqual(out[0].reasons, [markdownText(ugly)]);
  assert.equal(markdownLost(null), null);
  const d = { reason: 'lost_draws', case: ugly, lost, taken: 2 };
  const outD = markdownDraws(d);
  assert.equal(outD.case, markdownText(ugly));
  assert.equal(outD.lost[0].case, markdownText(ugly));
  assert.equal(outD.taken, 2);
  assert.equal(markdownDraws(null), null);
  const spread = markdownDraws({ reason: 'spread', case: 'c1', spread: 0.25 });
  assert.deepEqual(spread, { reason: 'spread', case: 'c1', spread: 0.25 });
});

// ── the two surfaces ─────────────────────────────────────────────────────────────────────────────
const LOST = null;
function arm(id, mode, scores, reason) {
  const draws = scores.map((x, i) => (x === LOST
    ? { draw_index: i, status: 'unmeasured', reason, samples: [], mean: null, stddev: null }
    : { draw_index: i, status: 'measured', samples: [x], mean: x, stddev: 0 }));
  const a = acrossDraws(draws);
  return { id, mode, mean: a.mean, generation: { draws, n_drawn: a.n_drawn, n_measured: a.n_measured, n_unmeasured: a.n_unmeasured, mean: a.mean, sd: a.sd } };
}
function receipt(id, withScores, baseScores, { model, skill = 'fx-skill', reason = 'timeout', level = 'TESTED', source = null } = {}) {
  const w = arm(id, 'with_skill', withScores, reason);
  const b = arm(id, 'baseline', baseScores, reason);
  return sealReceipt({
    verification_level: level,
    skill: { name: skill },
    suite: { case_count: 1 },
    run: { model_id: model, date_utc: '2026-09-29T00:00:00Z', status: 'complete', answered_by: { kind: level === 'TESTED' ? 'model' : 'stub' }, ...(source ? { source } : {}) },
    results: { cases: [w, b] },
    comparison: { with_skill_score: w.mean, baseline_score: b.mean, delta: w.mean - b.mean },
  });
}
function dirOf(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-escape-'));
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), typeof content === 'string' ? content : JSON.stringify(content));
  return dir;
}
const NASTY = '@octocat #12 GH-12 [x](https://e.example/l) ![i](https://e.example/p.png) <b>h</b> www.e.example `t` *e* _u_ ~s~ a|b\\ l1\rl2';
// Read left to right, as CommonMark reads inline text: a backslash pair is text, a backtick run opens a
// code span that the next run of the same length closes (a backslash inside it is a backslash), and
// what is left is what a reader acts on.
function live(md) {
  let out = '';
  for (let i = 0; i < md.length;) {
    if (md[i] === '\\' && i + 1 < md.length) { i += 2; continue; }
    if (md[i] === '`') {
      let n = 0; while (md[i + n] === '`') n += 1;
      let j = i + n; let close = -1;
      while (j < md.length) {
        if (md[j] !== '`') { j += 1; continue; }
        let m = 0; while (md[j + m] === '`') m += 1;
        if (m === n) { close = j; break; }
        j += m;
      }
      if (close < 0) { out += md.slice(i, i + n); i += n; continue; }
      i = close + n; continue;
    }
    out += md[i]; i += 1;
  }
  return out;
}
const assertNoneLive = (md, what) => {
  const left = live(md);
  const found = /@octocat|#12|GH-12|\]\(|<b>|:\/\/|www\.|&#|\*e\*|~s~|\r(?!\n)/.exec(left);
  assert.equal(found, null, `${what}: ${JSON.stringify(found && found[0])} in ${JSON.stringify(left.slice(0, 300))}`);
};

test('the job summary: a case id and a draw reason carry no live construct, and the columns hold', (t) => {
  const lost = receipt(NASTY, [0.85, 0.84, 0.86, LOST], [0.57, 0.58, 0.56], { model: 'fx-lost', reason: NASTY });
  const under = receipt(NASTY, [0.80], [0.79], { model: 'fx-under' });
  const dir = dirOf({ 'fx-lost-2026-09-29.json': lost, 'fx-under-2026-09-29.json': under });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const d = decision.decideSet(dir, 'fx-lost,fx-under');
  assert.deepEqual(d.rows.map((r) => r.state), ['inconclusive', 'underpowered']);
  const md = decision.summaryMarkdown(d, { lead: plain.summaryLead(d, dir, {}) });
  const rows = md.split('\n').filter((l) => /^\| `/.test(l));
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assertNoneLive(row, 'a row');
    // Four cells, counting a backslash as escaping any character (reader A) and only before a pipe (reader B).
    for (const readerA of [true, false]) {
      let n = 1;
      for (let i = 0; i < row.length; i += 1) {
        if (row[i] === '\\' && (readerA || row[i + 1] === '|')) { i += 1; continue; }
        if (row[i] === '|') n += 1;
      }
      assert.equal(n - 2, 4, `${readerA ? 'reader A' : 'reader B'}: ${row.slice(0, 120)}`);
    }
  }
  assert.ok(md.includes(lostDrawsLine(markdownLost(d.rows[0].lostDraws))));
  assert.ok(md.includes(drawsLine(markdownDraws(d.rows[1].drawsNeeded))));
});

test('draws needed because draws were lost: both surfaces carry the lost-draw entries escaped', (t) => {
  const r = receipt(NASTY, [0.80, 0.79, LOST], [0.80, 0.79, 0.78], { model: 'fx-bounded', skill: NASTY, reason: NASTY });
  const dir = dirOf({ 'fx-bounded-2026-09-29.json': r });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const d = decision.decideSet(dir, 'fx-bounded');
  assert.equal(d.rows[0].state, 'underpowered');
  assert.equal(d.rows[0].drawsNeeded.reason, 'lost_draws');
  const want = drawsLine(markdownDraws(d.rows[0].drawsNeeded));
  const md = decision.summaryMarkdown(d, { lead: plain.summaryLead(d, dir, {}) });
  assertNoneLive(md, 'the summary');
  assert.ok(md.includes(want), 'the summary carries the escaped draws line');
  const body = plain.commentMarkdown(d, dir, { key: 'abc123' });
  assertNoneLive(body.split('\n').find((l) => l.startsWith('Why: ')), 'the why line');
  assert.ok(body.includes(want), 'the comment carries the escaped draws line');
});

test('the job summary: a row with no draws line or no lost draws prints no word null', () => {
  const row = (state, extra) => ({ model: 'fx-m', state, delta: 0.1, reason: '', file: 'fx-m-2026-09-29.json', ...extra });
  const d = { rows: [row('underpowered', { drawsNeeded: null }), row('inconclusive', { lostDraws: [] })], receiptCount: 2, requestedCount: 2, worst: 'underpowered', unexpected: [] };
  const md = decision.summaryMarkdown(d);
  assert.doesNotMatch(md, /null/);
  const tails = md.split('\n').filter((l) => /^\| `/.test(l)).map((l) => (/<sub>(.*?)<\/sub>/.exec(l) || [])[1]);
  assert.equal(tails[0], underpoweredLine(null) + '. ');
  assert.equal(tails[1], '');
});

test('the job summary: a reason, a file name and an unclaimed file carry no live construct', (t) => {
  const dup = receipt(NASTY, [0.85, 0.84, 0.86], [0.57, 0.58, 0.56], { model: 'fx-dup' });
  dup.results.cases.push(structuredClone(dup.results.cases[0]));
  sealReceipt(dup);
  const odd = 'fx @octocat [x](y) `t`.json';
  const dir = dirOf({ 'fx-dup-2026-09-29.json': dup, [`sk-fx-bad-${odd}`]: '{not json', [`zz-${odd}`]: '{not json' });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const d = decision.decideSet(dir, 'fx-dup,fx-bad');
  assert.equal(d.rows[0].state, 'refused');
  assert.equal(d.rows[1].state, 'refused');
  const md = decision.summaryMarkdown(d, { lead: plain.summaryLead(d, dir, {}) });
  assertNoneLive(md, 'the summary');
  assert.ok(md.includes(`<sub>${markdownText(d.rows[0].reason)}</sub>`));
  assert.ok(md.includes(`| ${markdownText(d.rows[1].file)} <br>`));
  assert.ok(md.includes(`no requested model claimed: ${d.unexpected.map(markdownText).join(', ')}.`));
});

test('the job summary: a model id cannot end its own code span', () => {
  const d = { rows: [{ model: 'a`b @octocat', state: 'refused', delta: null, file: null, reason: 'no receipt for this model' }], receiptCount: 0, requestedCount: 1, worst: 'refused', unexpected: [] };
  const md = decision.summaryMarkdown(d, { lead: plain.summaryLead(d, os.tmpdir(), {}) });
  assert.ok(md.includes("| `a'b @octocat` |"), md);
  assert.ok(md.includes("**`a'b @octocat`: "), md);
  assertNoneLive(md, 'the summary');
});

test('the comment: the why line carries no live construct, and the marker stays the first line', (t) => {
  const lost = receipt(NASTY, [0.85, 0.84, 0.86, LOST], [0.57, 0.58, 0.56], { model: 'fx-lost', skill: NASTY, reason: NASTY });
  const dir = dirOf({ 'fx-lost-2026-09-29.json': lost });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const d = decision.decideSet(dir, 'fx-lost');
  const body = plain.commentMarkdown(d, dir, { key: 'abc123', runUrl: 'https://github.example/r/1' });
  const lines = body.split('\n');
  assert.equal(lines[0], plain.markerLine('abc123'));
  const why = lines.find((l) => l.startsWith('Why: '));
  assertNoneLive(why, 'the why line');
  assert.ok(why.includes(lostDrawsLine(markdownLost(d.rows[0].lostDraws))));
  // The skill is in a code span whose own backtick is changed, so it cannot end the span.
  assert.equal((lines[1].match(/`/g) || []).length, 4, lines[1]);
});

test('the comment: a refused row, two receipts for one model, an imported tool', (t) => {
  const dup = receipt(NASTY, [0.85, 0.84, 0.86], [0.57, 0.58, 0.56], { model: 'fx-dup' });
  dup.results.cases.push(structuredClone(dup.results.cases[0]));
  sealReceipt(dup);
  const dirDup = dirOf({ 'fx-dup-2026-09-29.json': dup });
  const two = ['a', 'b'].map(() => receipt('c1', [0.85, 0.84, 0.86], [0.57, 0.58, 0.56], { model: 'fx-two' }));
  const dirTwo = dirOf({ 'fx @octocat one.json': two[0], 'fx [x](y) two.json': two[1] });
  const imp = receipt('c1', [0.85, 0.84, 0.86], [0.57, 0.58, 0.56], { model: 'fx-imp', level: 'UNVERIFIED', source: `imported/${NASTY}` });
  const dirImp = dirOf({ 'fx-imp-2026-09-29.json': imp });
  t.after(() => { for (const x of [dirDup, dirTwo, dirImp]) fs.rmSync(x, { recursive: true, force: true }); });
  for (const [dir, models] of [[dirDup, 'fx-dup'], [dirTwo, 'fx-two'], [dirImp, 'fx-imp']]) {
    const d = decision.decideSet(dir, models);
    const body = plain.commentMarkdown(d, dir, { key: 'k' });
    assertNoneLive(body, models);
    const lead = plain.summaryLead(d, dir, {});
    assertNoneLive(lead, `${models} lead`);
  }
});

test('plainOf is not escaped: the view page and the reports read its words as they were', () => {
  const r = receipt(NASTY, [0.85, 0.84, 0.86, LOST], [0.57, 0.58, 0.56], { model: 'fx-v', reason: NASTY });
  const p = plain.plainOf(r);
  assert.ok(p.detail.includes(`case ${NASTY} `), p.detail);
});

// ── the comment as the Action posts it ───────────────────────────────────────────────────────────
function postTo(env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'action', 'comment.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { out += c; });
    child.on('close', (code) => resolve({ code, out }));
  });
}

test('action/comment.js posts the escaped body to the API it is given', async (t) => {
  const lost = receipt(NASTY, [0.85, 0.84, 0.86, LOST], [0.57, 0.58, 0.56], { model: 'fx-lost', skill: NASTY, reason: NASTY });
  const dir = dirOf({ 'fx-lost-2026-09-29.json': lost });
  const ev = path.join(dir, 'event.json');
  fs.writeFileSync(ev, JSON.stringify({ pull_request: { number: 7 } }));
  const seen = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (req.method === 'GET') return send(200, []);
      seen.push({ method: req.method, path: req.url, body: JSON.parse(raw) });
      return send(201, { id: 1 });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const env = {
    PATH: process.env.PATH, GITHUB_REPOSITORY: 'fx-owner/fx-repo', GITHUB_EVENT_PATH: ev, GITHUB_API_URL: `http://127.0.0.1:${server.address().port}`,
    GITHUB_SERVER_URL: 'https://github.example', GITHUB_RUN_ID: '1', GITHUB_TOKEN: 'placeholder-for-the-local-double',
    DRIFTPROOF_RECEIPTS: dir, INPUT_MODELS: 'fx-lost', INPUT_SKILL_DIR: 'skills/fx', INPUT_FAIL_ON_REGRESSION: 'true', INPUT_FAIL_ON_UNDERPOWERED: 'false',
  };
  const r = await postTo(env);
  assert.equal(r.code, 0, r.out);
  assert.equal(seen.length, 1, r.out);
  assert.equal(seen[0].method, 'POST');
  const body = seen[0].body.body;
  assert.match(body.split('\n')[0], /^<!-- driftproof:pr-comment [0-9a-f]{16} -->$/);
  // The last line is the comment's own: its job summary link is one the Action writes on purpose.
  assertNoneLive(body.split('\n').slice(0, -1).join('\n'), 'the posted body');
  const d = decision.decideSet(dir, 'fx-lost');
  assert.ok(body.includes(`Why: ${lostDrawsLine(markdownLost(d.rows[0].lostDraws))}`), body);
});

// ── issue 41: what GitHub links once the escapes are gone ────────────────────────────────────────
// GitHub finds a mention, an issue reference and a GH- reference in the text a document renders to, so a
// backslash before `@`, `#` or the hyphen does not stop one (measured on 6 Oct 2026). This checker shares
// no code with the escaper. It renders each line: a backslash before ASCII punctuation is that character,
// an unescaped character reference is decoded, a code span is its content. `outside` is the same with
// each code span made a space, where GitHub sees a text node end.
const ENTITY = { amp: '&', lt: '<', gt: '>', quot: '"', commat: '@', num: '#', hyphen: '-', sol: '/' };
function renderedOf(md) {
  const text = []; const outside = [];
  for (const line of String(md).split(/\r\n|\r|\n/)) {
    let t = ''; let o = '';
    for (let i = 0; i < line.length;) {
      const rest = line.slice(i);
      const esc = /^\\([!-/:-@[-`{-~])/.exec(rest);
      if (esc) { t += esc[1]; o += esc[1]; i += 2; continue; }
      const ent = /^&(?:#(\d+)|#x([0-9a-f]+)|(\w+));/i.exec(rest);
      const ch = ent && (ent[1] ? String.fromCodePoint(Number(ent[1])) : ent[2] ? String.fromCodePoint(parseInt(ent[2], 16)) : ENTITY[ent[3]]);
      if (ch) { t += ch; o += ch; i += ent[0].length; continue; }
      const ticks = /^`+/.exec(rest);
      if (ticks) {
        const fence = ticks[0];
        const end = new RegExp(`(?<!\`)${fence}(?!\`)`).exec(rest.slice(fence.length));
        if (!end) { t += fence; o += fence; i += fence.length; continue; }
        t += rest.slice(fence.length, fence.length + end.index); o += ' ';
        i += fence.length + end.index + fence.length; continue;
      }
      t += line[i]; o += line[i]; i += 1;
    }
    text.push(t); outside.push(o);
  }
  return { text: text.join('\n'), outside: outside.join('\n') };
}
// What GitHub links: an `@` and a handle (a team after a slash) after anything but a letter, a digit or an
// underscore; any `#` before a digit, with an owner/repo or not; a `GH-` before a digit after anything but
// a letter or a digit. More than GitHub links, never less.
function githubLinks(md) {
  const { outside } = renderedOf(md);
  return [
    ...[...outside.matchAll(/(?:^|[^A-Za-z0-9_])(@[A-Za-z0-9][\w-]*(?:\/[A-Za-z0-9][\w.-]*)?)/g)].map((m) => m[1]),
    ...[...outside.matchAll(/(?:[\w.-]+\/[\w.-]+)?#\d+/g)].map((m) => m[0]),
    ...[...outside.matchAll(/(?:^|[^A-Za-z0-9])(gh-\d+)/gi)].map((m) => m[1]),
  ];
}
const timesTyped = (md, name) => renderedOf(md).text.split(name).length - 1;
const EMAIL_LIKE = ['a', 'b.co'].join('@');
const HOSTILE_BARE = ['@octocat', '@org/team', '#1', 'GH-1', 'owner/repo#2', 'x @octocat y', '(#3)', EMAIL_LIKE];
const HOSTILE = [...HOSTILE_BARE, ...HOSTILE_BARE.map((n) => `\\${n}`)];
const PLAIN_NAME = 'zqplainname41';

test('issue 41: the checker reads a mention or a reference after a backslash as linked, and not in a code span', () => {
  for (const n of ['@octocat', '@org/team', '#1', 'GH-1', 'owner/repo#2', '(#3)']) {
    assert.ok(githubLinks(`x ${n} y`).length, n);
    assert.ok(githubLinks(`x ${n.replace(/[@#-]/g, '\\$&')} y`).length, `${n} after a backslash`);
    assert.deepEqual(githubLinks(`x \`${n}\` y`), [], `${n} in a code span`);
  }
  assert.deepEqual(githubLinks(`x ${EMAIL_LIKE} y`), []);
  assert.ok(githubLinks('x &#64;octocat y').length, 'a character reference is decoded');
  assert.equal(timesTyped('x \\\\`@octocat` y', '\\@octocat'), 1);
  assert.equal(timesTyped('x @​octocat y', '@octocat'), 0);
});

test('issue 41: markdownText leaves nothing GitHub links, and each hostile name renders as typed', () => {
  for (const n of HOSTILE) {
    const out = markdownText(n);
    assert.deepEqual(githubLinks(out), [], `${JSON.stringify(n)} wrote ${JSON.stringify(out)}`);
    assert.equal(renderedOf(out).text, n, `${JSON.stringify(n)} wrote ${JSON.stringify(out)}`);
  }
  // A word with two references in it is one code span, so no backtick run joins two spans.
  assert.deepEqual(githubLinks(markdownText('@a@b #1#2 GH-1GH-2')), []);
  assert.equal(renderedOf(markdownText('@a@b #1#2 GH-1GH-2')).text, '@a@b #1#2 GH-1GH-2');
  // A backslash before a hyphen is a doubled backslash, never read as the escape of the hyphen.
  assert.deepEqual(githubLinks(markdownText('\\-#1')), []);
  assert.equal(renderedOf(markdownText('\\-#1')).text, '\\-#1');
});

// The comment as action/comment.js posts it, to a local double on 127.0.0.1.
async function postedBody(t, dir, models) {
  const ev = path.join(dir, 'event.json');
  fs.writeFileSync(ev, JSON.stringify({ pull_request: { number: 7 } }));
  const seen = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      res.writeHead(req.method === 'GET' ? 200 : 201, { 'content-type': 'application/json' });
      if (req.method !== 'GET') seen.push(JSON.parse(raw).body);
      res.end(req.method === 'GET' ? '[]' : '{"id":1}');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const r = await postTo({
    PATH: process.env.PATH, GITHUB_REPOSITORY: 'fx-owner/fx-repo', GITHUB_EVENT_PATH: ev, GITHUB_API_URL: `http://127.0.0.1:${server.address().port}`,
    GITHUB_TOKEN: 'placeholder-for-the-local-double', DRIFTPROOF_RECEIPTS: dir, INPUT_MODELS: models, INPUT_SKILL_DIR: 'skills/fx',
    INPUT_FAIL_ON_REGRESSION: 'true', INPUT_FAIL_ON_UNDERPOWERED: 'false',
  });
  assert.equal(r.code, 0, r.out);
  assert.equal(seen.length, 1, r.out);
  return seen[0];
}

test('issue 41: the job summary and the posted comment carry each hostile case id, draw reason and skill name unlinked and as typed', async (t) => {
  const surfaces = async (name) => {
    const out = [];
    const sets = [
      ['fx-lost', 'inconclusive', receipt(name, [0.85, 0.84, 0.86, LOST], [0.57, 0.58, 0.56], { model: 'fx-lost', skill: name, reason: name })],
      ['fx-under', 'underpowered', receipt(name, [0.80], [0.79], { model: 'fx-under', skill: name })],
    ];
    for (const [model, state, r] of sets) {
      const dir = dirOf({ [`${model}-2026-09-29.json`]: r });
      t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
      const d = decision.decideSet(dir, model);
      assert.equal(d.rows[0].state, state, `${JSON.stringify(name)} ${model}`);
      out.push([`${model} summary`, decision.summaryMarkdown(d, { lead: plain.summaryLead(d, dir, {}) })]);
      out.push([`${model} comment`, await postedBody(t, dir, model)]);
    }
    return out;
  };
  const plainCounts = new Map((await surfaces(PLAIN_NAME)).map(([where, md]) => [where, timesTyped(md, PLAIN_NAME)]));
  for (const where of plainCounts.keys()) assert.ok(plainCounts.get(where) > 0, `the plain name reaches the ${where}`);
  for (const name of HOSTILE) {
    for (const [where, md] of await surfaces(name)) {
      assert.deepEqual(githubLinks(md), [], `${JSON.stringify(name)}: the ${where} leaves a link GitHub makes`);
      assert.equal(timesTyped(md, name), plainCounts.get(where), `${JSON.stringify(name)}: the ${where} renders the name as typed ${timesTyped(md, name)} time(s), the plain name ${plainCounts.get(where)}`);
    }
  }
});
