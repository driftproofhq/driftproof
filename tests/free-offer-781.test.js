// SPDX-License-Identifier: Apache-2.0
'use strict';
// Spec 781: the free offer. Every reading box is read back against the sealed receipt it names, through
// lib/verdict.js placeboReading, and every refusal has a plant. No model is called: every run is the
// stub, and every request, campaign and page plant is written under a temporary root, never the tree.
process.env.DRIFTPROOF_STUB = '1';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SPEC = path.join(ROOT, 'specs/781-free-offer');
const { placeboReading } = require('../lib/verdict');
const { plainOf } = require('../lib/plain');
const { sha256 } = require('../lib/canonical');
const { htmlToText } = require('../scripts/html-text.js');
// The modules this spec builds, required late so every test reads red, not the file, before the build.
const O = () => require('../scripts/offer.js');
const M = () => require('../scripts/build-measure.js');
const P = () => require(path.join(SPEC, 'protocol.cjs'));
const R = () => require(path.join(SPEC, 'run-campaign.cjs'));
const B = () => require(path.join(SPEC, 'build-plan.cjs'));
const I = () => import('../scripts/offer-intake.mjs');

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const json = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const code = (c) => (e) => e.code === c;
const text = (html) => htmlToText(html, { collapse: true }).replace(/\s+/g, ' ').trim();
const tmp = (p) => fs.mkdtempSync('/var/tmp/spec781-' + p + '-');
const HAIKU = 'claude-haiku-5-5', SONNET = 'claude-sonnet-5-5';
const SETTINGS = { permissions: { deny: ['Read', 'WebFetch', 'WebSearch'] }, syncClaudeAiSkills: false, syncClaudeAiPlugins: false, autoMemoryEnabled: false, disableClaudeAiConnectors: true };

// ── the independent oracle: the comment of 10 Nov 18:03, written here and not read from the module ──
const WANT = { ABOVE_PLACEBO: 'Keep', BELOW_PLACEBO: 'Delete candidate', NO_DIFFERENCE: 'Delete candidate', INCONCLUSIVE: 'Cannot tell', UNDERPOWERED: 'Cannot tell', NOT_MEASURED: 'Cannot tell' };
const NOT_MEASURABLE = 'Not measurable this way';
const NOT_AUTHOR = 'Requested by someone who is not the author.';
const LINE = "Want a skill measured, or think a result is wrong? It's free: how to ask.";
const FORMS = { pack: 'measure-pack.yml', skill: 'measure-skill.yml', challenge: 'challenge-result.yml' };

// Report 017's and Report 018's sealed receipts: real placebo readings to read boxes against.
function sealed() {
  const out = [];
  for (const [dir, run] of [['receipts/report-017c', 'campaign-1'], ['receipts/report-018', 'campaign-3']]) {
    const m = json(path.join(ROOT, dir, run, 'manifest.json'));
    for (const o of m.outcomes) if (o.status === 'receipt') out.push(`${dir}/${run}/${o.attempt_id}.json`);
  }
  return out;
}
const receiptAt = (rel) => json(path.join(ROOT, rel));
const attrs = (tag) => Object.fromEntries([...tag.matchAll(/\b(data-[a-z-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));

// THE BOX READER (AC-1, AC-4). Each box names its receipt; the reading is recomputed from that file
// with placeboReading and the label is read against the table above. A box with no receipt reads
// NOT_MEASURED. A not-measurable box reads NOT_MEASURED and carries the words in Cannot tell's place.
function boxes(html) {
  return [...html.matchAll(/<div class="offer-box"([^>]*)>([\s\S]*?)<\/div>/g)].map((m) => ({ a: attrs(m[1]), label: text((/<p class="offer-label">([\s\S]*?)<\/p>/.exec(m[2]) || [, ''])[1]), body: m[2] }));
}
// `view`, where given, is the request's own record: a box is not measurable exactly when the intake's
// text-only rule marked its skill so, which the box alone cannot show.
function boxProblems(html, root = ROOT, view = null) {
  const hits = [];
  for (const b of boxes(html)) {
    const where = `${b.a['data-skill']}/${b.a['data-model']}`;
    const recomputed = b.a['data-receipt'] ? placeboReading(json(path.join(root, b.a['data-receipt']))).reading : 'NOT_MEASURED';
    if (b.a['data-reading'] !== recomputed) hits.push(`${where}: data-reading ${b.a['data-reading']} is not the receipt's ${recomputed}`);
    const nm = b.a['data-not-measurable'] === 'true';
    const declared = view && view.skills.find((s) => s.skill === b.a['data-skill']);
    if (view && (!declared || nm === declared.measurable)) hits.push(`${where}: not measurable on the page is ${nm}, in the request ${declared ? !declared.measurable : 'absent'}`);
    if (nm && b.a['data-receipt']) hits.push(`${where}: a not-measurable skill names a receipt`);
    const want = nm ? NOT_MEASURABLE : WANT[recomputed];
    if (b.label !== want) hits.push(`${where}: labelled ${b.label}, the reading ${recomputed} is ${want}`);
    if (b.a['data-receipt'] && !b.body.includes(plainOf(json(path.join(root, b.a['data-receipt']))).sentence.replace(/&/g, '&amp;').slice(0, 30))) hits.push(`${where}: no verdict against no skill in the reader's words`);
  }
  return hits;
}
// A request page whose rows are Report 018's and Report 017's receipts for the same skills: one view.
function realView({ author = true, skills = ['triage', 'grill-me', 'tdd'] } = {}) {
  const byModel = { [SONNET]: 'receipts/report-017c/campaign-1', [HAIKU]: 'receipts/report-018/campaign-3' };
  const find = (model, skill) => sealed().find((f) => f.startsWith(byModel[model]) && receiptAt(f).skill.name === skill);
  return {
    request: { request: 7, issue: 101, kind: 'pack', repository: 'example-owner/example-pack', commit: 'a'.repeat(40), author, url: 'https://github.com/driftproofhq/driftproof/issues/101' },
    models: [HAIKU, SONNET],
    skills: skills.map((skill) => ({ skill, measurable: true, suite: { author: 'Driftproof', suite_hash: 'f'.repeat(64), cases: ['normal', 'edge', 'constraint'].map((id) => ({ id, prompt: `Task ${id} for ${skill}.`, rubric: `Score ${id}.` })) }, boxes: [HAIKU, SONNET].map((model) => ({ model, receipt: find(model, skill) })) })),
  };
}

test('781 AC-1: the label table is the comment\'s mapping, six readings and the router words', () => {
  for (const [reading, label] of Object.entries(WANT)) {
    assert.equal(O().LABELS[O().labelOf(reading)], label, reading);
    assert.equal(O().LABELS[O().labelOf(reading, true)], NOT_MEASURABLE, `${reading}, not measurable`);
  }
  assert.throws(() => O().labelOf('PASSED'), code('READING_UNKNOWN'));
  assert.deepEqual(Object.keys(O().MAPPING).sort(), Object.keys(WANT).sort());
});

test('781 AC-1, AC-3, AC-13: a request page\'s boxes read back against their receipts; plants read red', () => {
  const html = M().requestPage(realView());
  assert.deepEqual(boxProblems(html), []);
  assert.equal(boxes(html).length, 6, 'three skills on two models');
  const triage = boxes(html).find((b) => b.a['data-skill'] === 'triage' && b.a['data-model'] === HAIKU);
  assert.equal(triage.a['data-reading'], 'ABOVE_PLACEBO');
  // Plant: an ABOVE_PLACEBO box recast as NO_DIFFERENCE shown as Keep, then the label alone changed.
  const tag = /<div class="offer-box"[^>]*data-skill="triage"[^>]*data-model="claude-haiku-5-5"[^>]*>[\s\S]*?<\/div>/.exec(html)[0];
  assert.notDeepEqual(boxProblems(html.replace(tag, tag.replace('data-reading="ABOVE_PLACEBO"', 'data-reading="NO_DIFFERENCE"'))), [], 'plant: NO_DIFFERENCE planted as Keep');
  const below = /<div class="offer-box"[^>]*data-skill="grill-me"[^>]*data-model="claude-haiku-5-5"[^>]*>[\s\S]*?<\/div>/.exec(html)[0];
  assert.match(below, /data-reading="BELOW_PLACEBO"/);
  assert.notDeepEqual(boxProblems(html.replace(below, below.replace('>Delete candidate<', '>Keep<'))), [], 'plant: a delete candidate relabelled Keep');
  const under = boxes(html).find((b) => b.a['data-reading'] === 'UNDERPOWERED');
  assert.ok(under && under.label === 'Cannot tell', 'an UNDERPOWERED box reads Cannot tell');
});

test('781 AC-2: the module reads every Report 017 and 018 receipt as placeboReading and plainOf do', () => {
  for (const rel of sealed()) {
    const r = receiptAt(rel), got = O().readingOf(r);
    assert.equal(got.reading, placeboReading(r).reading, rel);
    assert.equal(got.label, WANT[got.reading], rel);
    assert.equal(got.against_no_skill, plainOf(r).sentence, rel);
  }
  const src = read('scripts/offer.js');
  assert.match(src, /require\('\.\.\/lib\/verdict'\)/);
  assert.doesNotMatch(src, /function caseRule|separated-up|EFFECT_FLOOR/, 'no copy of the case rule');
});

test('781 AC-3: one box per skill and per model, the headline per model, never merged; plants', () => {
  const view = realView({ skills: ['triage', 'grill-me', 'hyperframes'] });
  const html = M().requestPage(view);
  const per = (h) => {
    const hits = [];
    const bySkill = new Map();
    for (const b of boxes(h)) bySkill.set(b.a['data-skill'], [...(bySkill.get(b.a['data-skill']) || []), b]);
    for (const [s, bs] of bySkill) if (JSON.stringify(bs.map((b) => b.a['data-model']).sort()) !== JSON.stringify([HAIKU, SONNET])) hits.push(`${s}: models ${bs.map((b) => b.a['data-model'])}`);
    if (bySkill.size !== view.skills.length) hits.push('a skill has no boxes');
    const both = [...bySkill.values()].filter((bs) => bs.every((b) => b.label === 'Delete candidate')).length;
    const head = /<p class="offer-both" data-both="(\d+)" data-total="(\d+)">([\s\S]*?)<\/p>/.exec(h);
    if (!head || Number(head[1]) !== both || Number(head[2]) !== bySkill.size || !text(head[3]).startsWith(`${both} of ${bySkill.size} `)) hits.push('the both-model count is not the boxes\'');
    for (const m of [HAIKU, SONNET]) {
      const row = new RegExp(`<li data-model="${m}" data-keep="(\\d+)" data-delete="(\\d+)" data-cannot="(\\d+)" data-not-measurable="(\\d+)">`).exec(h);
      const mine = boxes(h).filter((b) => b.a['data-model'] === m);
      const n = (l) => mine.filter((b) => b.label === l).length;
      if (!row || [n('Keep'), n('Delete candidate'), n('Cannot tell'), n(NOT_MEASURABLE)].join() !== row.slice(1).join()) hits.push(`${m}: the per-model count is not its boxes'`);
    }
    return hits;
  };
  assert.deepEqual(per(html), []);
  // grill-me: BELOW on Haiku, UNDERPOWERED on Sonnet; hyperframes: BELOW on Haiku, ABOVE on Sonnet. A
  // delete candidate on one model only is not one on both: the count is 0, never a merged label.
  assert.match(html, /data-both="0" data-total="3"/);
  assert.match(html, /<li data-model="claude-haiku-5-5" data-keep="1" data-delete="2" data-cannot="0" data-not-measurable="0">/);
  const one = /<div class="offer-box"[^>]*data-skill="triage"[^>]*data-model="claude-sonnet-5-5"[^>]*>[\s\S]*?<\/div>/.exec(html)[0];
  assert.notDeepEqual(per(html.replace(one, '')), [], 'plant: one model\'s box removed');
  assert.notDeepEqual(per(html.replace('data-both="0"', 'data-both="1"')), [], 'plant: the both-model count one high');
});

test('781 AC-4: a router shows the words in Cannot tell\'s place, and a text skill never does; plants', () => {
  const view = realView({ skills: ['triage'] });
  view.skills.push({ skill: 'find-skills', measurable: false, reason: 'It routes to other skills, so a text task cannot show what it does.', suite: null, boxes: [HAIKU, SONNET].map((model) => ({ model, receipt: null })) });
  const html = M().requestPage(view);
  assert.deepEqual(boxProblems(html, ROOT, view), []);
  const router = boxes(html).filter((b) => b.a['data-skill'] === 'find-skills');
  assert.equal(router.length, 2);
  assert.ok(router.every((b) => b.label === NOT_MEASURABLE && b.body.includes('It routes to other skills')));
  const tag = /<div class="offer-box"[^>]*data-skill="find-skills"[^>]*>[\s\S]*?<\/div>/.exec(html)[0];
  assert.notDeepEqual(boxProblems(html.replace(tag, tag.replace(`>${NOT_MEASURABLE}<`, '>Cannot tell<')), ROOT, view), [], 'plant: a router shown as Cannot tell');
  assert.notDeepEqual(boxProblems(html.replace(tag, tag.replace(' data-not-measurable="true"', '').replace(`>${NOT_MEASURABLE}<`, '>Cannot tell<')), ROOT, view), [], 'plant: a router shown as a measured Cannot tell');
  const text1 = /<div class="offer-box"[^>]*data-skill="triage"[^>]*>[\s\S]*?<\/div>/.exec(html)[0];
  assert.notDeepEqual(boxProblems(html.replace(text1, text1.replace(/data-receipt="[^"]*"/, 'data-receipt="" data-not-measurable="true"').replace(/>Keep</, `>${NOT_MEASURABLE}<`).replace('data-reading="ABOVE_PLACEBO"', 'data-reading="NOT_MEASURED"')), ROOT, view), [], 'plant: a text-only skill shown as not measurable');
});

// ── a public skill repository, as git serves it, under a temporary root ──
function git(cwd, ...args) { const r = spawnSync('git', args, { cwd, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); }
const skillText = (name, body = `Write plain, direct answers for ${name} tasks. Lead with the answer, then one reason.`) => `---\nname: ${name}\ndescription: Synthetic skill ${name} for the offer test.\n---\n${body}\n`;
function repoFixture(files, exec = []) {
  const dir = tmp('repo');
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@example.com'); git(dir, 'config', 'user.name', 'test');
  for (const [rel, body] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), body); if (exec.includes(rel)) fs.chmodSync(path.join(dir, rel), 0o755); }
  git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'fixture');
  return { dir, commit: git(dir, 'rev-parse', 'HEAD') };
}
const issueBody = (fields) => Object.entries(fields).map(([k, v]) => `### ${k}\n\n${v}`).join('\n\n');
const issue = (number, kind, fields, extra = {}) => ({ number, title: `${kind}: ${number}`, state: 'OPEN', url: `https://github.com/driftproofhq/driftproof/issues/${number}`, createdAt: `2026-11-1${number % 9}T00:00:00Z`, labels: [{ name: 'offer' }, { name: `offer-${kind}` }], body: issueBody(fields), ...extra });
const packIssue = (number, paths, author = 'Yes') => issue(number, 'pack', { 'Repository link': 'https://github.com/example-owner/example-pack', 'Skill paths': paths.join('\n'), 'Are you the author?': author });
const skillIssue = (number, author = 'Yes') => issue(number, 'skill', { 'Repository link': 'https://github.com/example-owner/example-pack', 'Skill path': 'skills/alpha/SKILL.md', 'Are you the author?': author });

// A-781-1 (the controller's ruling of 10 Nov 2026): a skill is text-only when nothing in its folder runs.
// The reason names the file by its path in the folder and its actual cause, never "not a text file".
const file = (p, body, mode = '100644') => ({ path: p, mode, bytes: Buffer.isBuffer(body) ? body : Buffer.from(body) });
const SKILL = (name = 'alpha') => file('SKILL.md', skillText(name));
const BINARY = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x00, 0x00, 0xff, 0xfe]);
test('781 AC-5 (A-781-1): the text-only rule: text formats read text, and a file that runs names itself and its cause', () => {
  const t = (files, name = 'alpha', body = skillText(name)) => O().textOnly({ name, text: body, files });
  assert.deepEqual(t([SKILL()]), { measurable: true, reason: null });
  // Every UTF-8 file is text, whatever its format.
  for (const p of ['evals/evals.json', 'notes.yaml', 'config.yml', 'data.csv', 'settings.toml', 'feed.xml', 'template.html', 'notes.txt', 'references/guide.md', 'LICENSE', '.gitignore']) {
    assert.deepEqual(t([SKILL(), file(p, p.endsWith('.json') ? '{"skill_name":"alpha","evals":[]}\n' : 'key: value\n')]), { measurable: true, reason: null }, `plant: ${p} reads text-only`);
  }
  // A file that runs: by extension, by an executable bit, by a first line "#!", or not plain text.
  const r = (files) => { const got = t([SKILL(), ...files]); assert.equal(got.measurable, false, JSON.stringify(files.map((f) => f.path))); assert.doesNotMatch(got.reason, /not a text file/); return got.reason; };
  assert.match(r([file('run.py', 'print(1)\n')]), /holds run\.py, which is a script,/, 'plant: run.py');
  assert.match(r([file('scripts/build.ts', 'export {}\n')]), /holds scripts\/build\.ts, which is a script,/, 'the path in the folder, not the base name');
  assert.match(r([file('tool.exe', BINARY)]), /holds tool\.exe, which is a program,/);
  assert.match(r([file('bin/go', 'echo hi\n', '100755')]), /holds bin\/go, which has an executable bit,/, 'plant: an executable bit');
  assert.match(r([file('notes.txt', 'echo hi\n', '100755')]), /holds notes\.txt, which has an executable bit,/, 'an executable bit on a text format');
  assert.match(r([file('setup', '#!/bin/sh\necho hi\n')]), /holds setup, which is a script,/, 'a first line starting #!');
  assert.match(r([file('blob.dat', BINARY)]), /holds blob\.dat, which is not plain text,/, 'plant: an unknown binary');
  // An image or a PDF does not run: known by its leading bytes, never by its name.
  const ASSET = {
    'assets/logo.png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52],
    'photo.jpg': [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46],
    'anim.gif': [...Buffer.from('GIF89a'), 0x01, 0x00, 0x01, 0x00, 0x80, 0xff],
    'pic.webp': [...Buffer.from('RIFF'), 0x24, 0x00, 0x00, 0x00, ...Buffer.from('WEBPVP8 '), 0xff],
    'favicon.ico': [0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x10, 0x10, 0x00, 0xff],
    'old.bmp': [...Buffer.from('BM'), 0x36, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff],
    'new.avif': [0x00, 0x00, 0x00, 0x1c, ...Buffer.from('ftypavif'), 0x00, 0xff],
    'guide.pdf': [...Buffer.from('%PDF-1.7\n'), 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x00],
  };
  for (const [p, bytes] of Object.entries(ASSET)) assert.deepEqual(t([SKILL(), file(p, Buffer.from(bytes))]), { measurable: true, reason: null }, `plant: ${p} with its real signature reads text-only`);
  assert.match(r([file('logo.png', '#!/bin/sh\necho hi\n')]), /holds logo\.png, which is a script,/, 'plant: a .png whose bytes are #!/bin/sh');
  assert.match(r([file('logo.png', BINARY)]), /holds logo\.png, which is not plain text,/, 'a .png that is no image');
  assert.match(r([file('guide.pdf', Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x00]))]), /holds guide\.pdf, which is not plain text,/, 'a .pdf that is no PDF');
  assert.match(r([file('logo.png', Buffer.from(ASSET['assets/logo.png']), '100755')]), /holds logo\.png, which has an executable bit,/, 'an image with an executable bit');
  assert.match(r([file('latin.txt', Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]))]), /holds latin\.txt, which is not plain text,/, 'invalid UTF-8');
  assert.match(r([file('nul.md', Buffer.from('a\0b'))]), /holds nul\.md, which is not plain text,/, 'a NUL');
  // .git/ is never read as the skill's.
  assert.deepEqual(t([SKILL(), file('.git/hooks/pre-commit', '#!/bin/sh\n', '100755')]), { measurable: true, reason: null });
  // The skill's own rules stand.
  assert.equal(t([SKILL()], 'alpha', '---\nname: alpha\nallowed-tools: Bash\n---\nRun it.\n').measurable, false, 'a tools key');
  assert.equal(t([SKILL()], 'alpha', '---\nname: alpha\n---\nCall the Skill tool with "beta".\n').measurable, false, 'a hand-off only');
  assert.equal(t([SKILL('find-skills')], 'find-skills').measurable, false, 'a Report 015 router');
});

// F-1: a skill at the repository's root reads the root as its folder, with names relative to it, and no
// prefix cut from any of them. The intake pins it as git serves it.
async function pinOne(files, skillPath, exec = []) {
  const repo = repoFixture(files, exec);
  const intake = await I();
  const iss = issue(31, 'skill', { 'Repository link': 'https://github.com/example-owner/example-pack', 'Skill path': skillPath, 'Are you the author?': 'Yes' });
  const entry = O().queueOf({ issues: [iss], previous: null, records: {}, asOf: '2026-11-11' }).requests[0];
  assert.equal(entry.state, 'queued', JSON.stringify(entry));
  const dir = intake.pin({ requests: tmp('requests'), entry, issue: iss, remote: () => repo.dir });
  return json(path.join(dir, 'request.json')).skills;
}
test('781 AC-5 (F-1, F-2): the intake reads a root-level skill\'s folder with correct names, and evals/evals.json is text', async () => {
  const root = { 'SKILL.md': skillText('rooted'), '.gitignore': 'node_modules/\n', 'docs/config.yaml': 'mode: plain\n', 'other/nested/SKILL.md': skillText('nested'), 'evals/evals.json': '{"skill_name":"rooted","evals":[]}\n' };
  for (const p of ['.', './', 'SKILL.md']) assert.deepEqual((await pinOne(root, p)).map((s) => [s.skill, s.skill_path, s.measurable, s.reason]), [['rooted', 'SKILL.md', true, null]], `plant: a root-level skill with a dotfile and nested files, written ${p}`);
  const withScript = await pinOne({ ...root, 'tools/run.py': 'print(1)\n' }, '.');
  assert.equal(withScript[0].measurable, false);
  assert.match(withScript[0].reason, /^Its folder holds tools\/run\.py, which is a script, so a text task cannot show what it does\.$/, 'the nested file named whole, never cut');
  const exe = await pinOne({ ...root, 'helper': 'echo hi\n' }, '.', ['helper']);
  assert.match(exe[0].reason, /holds helper, which has an executable bit,/);
  // A skill in a folder: its own files only, named from its folder; a sibling folder's script is not its.
  const nested = await pinOne({ 'skills/alpha/SKILL.md': skillText('alpha'), 'skills/alpha/evals/evals.json': '{"evals":[]}\n', 'skills/beta/run.sh': 'echo\n' }, 'skills/alpha', ['skills/beta/run.sh']);
  assert.deepEqual(nested.map((s) => [s.skill, s.measurable, s.reason]), [['alpha', true, null]], 'plant: a skill with evals/evals.json reads text-only');
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);
  const png = await pinOne({ 'skills/alpha/SKILL.md': skillText('alpha'), 'skills/alpha/assets/logo.png': PNG }, 'skills/alpha');
  assert.deepEqual(png.map((s) => [s.measurable, s.reason]), [[true, null]], 'plant: a real PNG in the folder reads text-only');
  const fake = await pinOne({ 'skills/alpha/SKILL.md': skillText('alpha'), 'skills/alpha/assets/logo.png': '#!/bin/sh\necho hi\n' }, 'skills/alpha');
  assert.match(fake[0].reason, /^Its folder holds assets\/logo\.png, which is a script,/, 'plant: a script renamed .png');
  const bin = await pinOne({ 'skills/alpha/SKILL.md': skillText('alpha'), 'skills/alpha/assets/blob.dat': BINARY }, 'skills/alpha');
  assert.match(bin[0].reason, /^Its folder holds assets\/blob\.dat, which is not plain text,/, 'plant: an unknown binary');
});

test('781 AC-9, AC-10: numbering keeps earlier numbers; past 50 and over 20 skills refuse; the author answer is read', () => {
  const paths = (n) => Array.from({ length: n }, (_, i) => `skills/s${i}/SKILL.md`);
  const issues = [packIssue(3, paths(20)), packIssue(4, paths(21)), ...Array.from({ length: 50 }, (_, i) => skillIssue(10 + i, i === 0 ? 'No' : 'Yes'))];
  const previous = { as_of: '2026-11-10', requests: [{ request: 1, issue: 9, kind: 'skill', state: 'queued' }] };
  const q = O().queueOf({ issues: [...issues, skillIssue(9)], previous, records: {}, asOf: '2026-11-11' });
  const by = (n) => q.requests.find((r) => r.issue === n);
  assert.equal(by(9).request, 1, 'an earlier number is kept');
  assert.equal(by(3).request, 2); assert.equal(by(3).state, 'queued', 'a 20-skill pack is admitted');
  assert.equal(by(4).state, 'refused'); assert.match(by(4).reason, /20 skills/);
  assert.equal(by(10).author, false); assert.equal(by(11).author, true);
  const fiftieth = q.requests.find((r) => r.request === 50), fiftyFirst = q.requests.find((r) => r.request === 51);
  assert.notEqual(fiftieth.state, 'refused', 'the 50th request is admitted');
  assert.equal(fiftyFirst.state, 'refused'); assert.match(fiftyFirst.reason, /first 50 requests/);
  assert.equal(q.count, Math.min(50, q.requests.length));
});

test('781 AC-10: the not-author line appears exactly when the form says No; plants', () => {
  const lineHits = (html, author) => {
    const n = text(html).split(NOT_AUTHOR).length - 1;
    return author ? (n === 0 ? [] : ['the line on an author\'s request']) : (n === 1 ? [] : [`the line ${n} times on a not-author request`]);
  };
  const no = M().requestPage(realView({ author: false })), yes = M().requestPage(realView({ author: true }));
  assert.deepEqual(lineHits(no, false), []); assert.deepEqual(lineHits(yes, true), []);
  assert.notDeepEqual(lineHits(no.replace(NOT_AUTHOR, ''), false), [], 'plant: a No request without the line');
  assert.notDeepEqual(lineHits(yes.replace('</h1>', `</h1><p>${NOT_AUTHOR}</p>`), true), [], 'plant: a Yes request with the line');
});

// ── the line on every skill page and report (AC-11) ──
function askPages() {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  return [
    ...walk(path.join(ROOT, 'docs/skills')).filter((f) => f.endsWith('index.html')),
    ...fs.readdirSync(path.join(ROOT, 'docs/reports')).filter((n) => /^\d+$/.test(n)).map((n) => path.join(ROOT, 'docs/reports', n, 'index.html')),
    path.join(ROOT, 'docs/reports/index.html'),
  ].map((f) => path.relative(path.join(ROOT, 'docs'), f));
}
const EXCLUDE = new RegExp(/EXCLUDE_RE='([^']+)'/.exec(read('scripts/build-public.sh'))[1]);
function lineHits(pages, exclude = EXCLUDE, templates = path.join(ROOT, '.github/ISSUE_TEMPLATE')) {
  const hits = [];
  for (const [rel, html] of pages) {
    if (rel === 'measure/index.html') continue;
    const n = (html.match(/<p class="offer-ask">/g) || []).length;
    if (n !== 1) { hits.push(`${rel}: the line ${n} times`); continue; }
    const p = /<p class="offer-ask">([\s\S]*?)<\/p>/.exec(html)[1];
    if (text(p) !== LINE || !p.includes('<a href="/measure/">how to ask</a>')) hits.push(`${rel}: the line reads ${text(p)}`);
    const main = html.slice(html.indexOf('<main'), html.lastIndexOf('</main>'));
    if (main.includes('offer-ask')) hits.push(`${rel}: the line is inside <main>`);
  }
  const measure = pages.get('measure/index.html');
  if (!measure) hits.push('no /measure/ page');
  else {
    const forms = [...measure.matchAll(/href="https:\/\/github\.com\/driftproofhq\/driftproof\/issues\/new\?template=([^"&]+)"/g)].map((m) => m[1]);
    if (JSON.stringify([...new Set(forms)].sort()) !== JSON.stringify(Object.values(FORMS).sort())) hits.push(`/measure/ links the forms ${forms}`);
    for (const f of forms) {
      if (!fs.existsSync(path.join(templates, f))) hits.push(`${f}: no such template`);
      if (exclude.test(`.github/ISSUE_TEMPLATE/${f}`)) hits.push(`${f}: the public build excludes it`);
    }
  }
  return hits;
}
test('781 AC-11: every skill page and report carries the line once, outside <main>, and its forms exist publicly; plants', () => {
  const pages = new Map([...askPages().map((rel) => [rel, read(`docs/${rel}`)]), ['measure/index.html', read('docs/measure/index.html')]]);
  assert.ok(pages.size > 100, `${pages.size} pages`);
  assert.deepEqual(lineHits(pages), []);
  const some = askPages().find((r) => r.startsWith('reports/0'));
  const plant = (rel, f) => { const m = new Map(pages); m.set(rel, f(m.get(rel))); return lineHits(m); };
  assert.notDeepEqual(plant(some, (h) => h.replace(/<p class="offer-ask">[\s\S]*?<\/p>/, '')), [], 'plant: a page without the line');
  assert.notDeepEqual(plant('skills/index.html', (h) => h.replace(/(<p class="offer-ask">[\s\S]*?<\/p>)/, '$1$1')), [], 'plant: a page with the line twice');
  assert.notDeepEqual(plant('measure/index.html', (h) => h.replace('template=measure-pack.yml', 'template=measure-packs.yml')), [], 'plant: a link to a missing template');
  assert.notDeepEqual(lineHits(pages, /^\.github\/ISSUE_TEMPLATE\//), [], 'plant: the public build excludes the forms');
  // The line's module loads in the public tree, which carries no specs/: nothing under specs/ at load.
  const loadsWithoutSpecs = (file) => spawnSync(process.execPath, ['-e', `const M=require('node:module'),o=M._resolveFilename;M._resolveFilename=function(r,...a){const f=o.call(this,r,...a);if(f.split(require('node:path').sep).includes('specs'))throw new Error('specs/ at load: '+f);return f};const c=require(process.argv[1]);const h=require(process.argv[2]).applyChrome('<html><head></head><body><main><h1>x</h1></main><footer class="site"></footer></body></html>','skills/index.html');if(!h.includes(require(process.argv[3]).askLine()))throw new Error('no line')`, path.join(ROOT, file), path.join(ROOT, 'scripts/site-chrome.js'), path.join(ROOT, 'scripts/offer.js')], { encoding: 'utf8' });
  const loaded = loadsWithoutSpecs('scripts/offer.js');
  assert.equal(loaded.status, 0, loaded.stderr);
  // The forms: each kind's label and the shared offer label, and the fields the intake reads.
  for (const [kind, f] of Object.entries(FORMS)) {
    const y = read(`.github/ISSUE_TEMPLATE/${f}`);
    assert.match(y, new RegExp(`labels: \\[offer, offer-${kind}\\]`), f);
    assert.match(y, /label: Are you the author\?/, f);
    for (const k of Object.keys(O().FIELDS[kind])) assert.ok(y.includes(`label: ${k}`), `${f}: ${k}`);
  }
  // The chooser points private skills to email (the comment of 10 Nov 18:03, item 1); blank issues stay.
  const config = read('.github/ISSUE_TEMPLATE/config.yml');
  assert.match(config, /contact_links:[\s\S]*name: A private skill[\s\S]*hello@driftproofhq\.com/);
  assert.doesNotMatch(config, /blank_issues_enabled/);
});

// ── the offer page (AC-12) and the queue (AC-16) ──
const PAGE_WORDS = [
  "Send us your skills. We'll tell you which ones you can delete on Claude 5.",
  'Claude 5 models do a lot without help. Some skills still earn their place. Others now do no better than a block of filler text of the same length. Send us a public skill pack, or a single skill, and we\'ll measure every skill and publish what we find. It\'s free.',
  "For each skill we write three tasks from the skill's own text and its README: a normal case, an edge case and a constraint case. We run each task on Claude Haiku 5.5 and Claude Sonnet 5.5 three ways:",
  'with a placebo: a text the same length as the skill that tells the model nothing useful.',
  // The one change the code needs (spec 781, Inferences made): the judge is Haiku 5.5, one of the two answering models.
  'A separate grader, Claude Haiku 5.5, scores every answer. The tasks are published with the result, so anyone can check them.',
  'Keep. On at least one task the skill scored above the placebo, and on none did it score below. Its words do something that the same amount of text does not.',
  'Delete candidate. The skill did not beat the placebo on these tasks: it scored below it on at least one task (even if it scored above it on another), or no task differed by as much as the test can detect. That is a reason to try working without it. It is not proof the skill does nothing, because your own tasks may differ from ours.',
  'Cannot tell. The results were too uncertain to read either way, or the skill cannot be measured this way.',
  'A skill can be a keep on one model and a delete candidate on the other. We show both.',
  'We measure text-only skills. A skill that routes to other skills or drives tools is marked "not measurable this way", because a text task can\'t show what it does.',
  'A pack (up to 20 skills): open a Measure a pack request with the repository link.',
  'One skill: open a Measure a skill request.',
  'Challenge a result: if you think we tested your skill unfairly, open a Challenge a result request with your own three tasks. We re-run with your tasks and publish both results side by side.',
  'If the skill is private, email hello@driftproofhq.com instead of opening a public request.',
  "Anyone can ask, not only the author. If you're not the author, the result page says so.",
  'We publish the result, whatever it says.',
  'Results come within three days of your request reaching the front of the queue. The queue is below.',
  'We re-run every result on the next Claude model.',
  'Open to the first 50 requests. A pack can hold up to 20 skills.',
];
const pageHits = (html) => { const t = text(html.slice(html.indexOf('<main'), html.lastIndexOf('</main>'))); return PAGE_WORDS.filter((w) => !t.includes(w)); };
test('781 AC-12: /measure/ carries the approved words and the module\'s label definitions; plant', () => {
  const html = read('docs/measure/index.html');
  assert.deepEqual(pageHits(html), []);
  assert.doesNotMatch(text(html), /A separate model scores every answer/);
  for (const k of ['keep', 'delete', 'cannot']) assert.ok(text(html).includes(O().DEFINITIONS[k]), k);
  assert.notDeepEqual(pageHits(html.replace('On at least one task the skill scored above the placebo, and on none did it score below.', 'The skill scored above the placebo on every task.')), [], 'plant: the Keep definition widened');
  assert.match(html, /<section class="offer-queue" data-queue>/);
  assert.equal(M().check().length >= 1, true, 'the builder\'s --check reads the committed page');
});

const queueHits = (html, q) => {
  const hits = [];
  for (const r of q.requests) {
    const row = new RegExp(`<tr data-request="${r.request}" data-state="${r.state}"[^>]*>([\\s\\S]*?)</tr>`).exec(html);
    if (!row) { hits.push(`request ${r.request} is not listed as ${r.state}`); continue; }
    if (r.state === 'refused' && !text(row[1]).includes(r.reason)) hits.push(`request ${r.request}: no reason`);
    if (r.state === 'queued' && !new RegExp(`data-position="${r.position}"`).test(row[0])) hits.push(`request ${r.request}: no position`);
  }
  const count = /<p data-count="(\d+)" data-limit="50">([\s\S]*?)<\/p>/.exec(html);
  if (!count || Number(count[1]) !== q.count || !text(count[2]).startsWith(`${q.count} of 50`)) hits.push('the count is not the queue\'s');
  if (!html.includes(`<time data-as-of datetime="${q.as_of}">`)) hits.push('no as-of date');
  if (!html.includes(`href="${O().OFFER.live.replace(/&/g, '&amp;')}"`)) hits.push('no live list link');
  return hits;
};
test('781 AC-16: the queue lists every numbered request with its state, the count of 50 and the as-of date; plants', () => {
  const issues = [packIssue(3, ['skills/a/SKILL.md']), skillIssue(5, 'No'), packIssue(6, Array.from({ length: 21 }, (_, i) => `s${i}/SKILL.md`))];
  const q = O().queueOf({ issues, previous: null, records: {}, asOf: '2026-11-11' });
  const html = M().measurePage({ queue: q });
  assert.deepEqual(queueHits(html, q), []);
  assert.notDeepEqual(queueHits(html.replace(/<tr data-request="2"[\s\S]*?<\/tr>/, ''), q), [], 'plant: a request dropped');
  assert.notDeepEqual(queueHits(html.replace(/data-count="3"/, 'data-count="2"'), q), [], 'plant: the count one off');
  // The committed queue is the page's.
  const committed = json(path.join(ROOT, 'docs/data/offer-queue.json'));
  assert.deepEqual(queueHits(read('docs/measure/index.html'), committed), []);
});

test('781 AC-14, AC-15: the tasks are the suite\'s, and a challenge page shows both results side by side; plants', () => {
  const view = realView({ skills: ['triage'] });
  const html = M().requestPage(view);
  const taskHits = (h, v) => v.skills.filter((s) => s.suite).flatMap((s) => s.suite.cases.filter((c) => !text(h).includes(c.prompt)).map((c) => `${s.skill}/${c.id}`)).concat(text(h).includes('Driftproof wrote these tasks') ? [] : ['no author of the tasks']);
  assert.deepEqual(taskHits(html, view), []);
  assert.notDeepEqual(taskHits(html.replace('Task edge for triage.', 'Task edge for something else.'), view), [], 'plant: a task the suite does not hold');
  const original = realView({ skills: ['triage'] });
  const challenge = { ...realView({ skills: ['triage'] }), request: { ...view.request, request: 8, kind: 'challenge' }, original: { href: '/measure/requests/007/', request: 7, skills: original.skills } };
  challenge.skills[0].suite.author = 'requester';
  const ch = M().requestPage(challenge);
  const sideHits = (h) => [HAIKU, SONNET].flatMap((m) => ['original', 'challenge'].filter((c) => !new RegExp(`<div class="offer-box"[^>]*data-column="${c}"[^>]*data-model="${m}"`).test(h)).map((c) => `${m}: no ${c} column`)).concat(text(h).includes('The requester wrote these tasks') ? [] : ['the requester is not named as the tasks\' author']);
  assert.deepEqual(sideHits(ch), []);
  assert.deepEqual(boxProblems(ch), []);
  assert.notDeepEqual(sideHits(ch.replace(/<div class="offer-box"[^>]*data-column="original"[^>]*>[\s\S]*?<\/div>/g, '')), [], 'plant: no original column');
});

// ── the request, its plan and a stub run (AC-6, AC-7, AC-8, AC-13, AC-17) ──
async function request({ skills = { alpha: skillText('alpha'), 'find-skills': skillText('find-skills') }, author = 'Yes' } = {}) {
  const files = { 'README.md': '# Example pack\n\nSynthetic skills for the offer test.\n' };
  for (const [name, body] of Object.entries(skills)) files[`skills/${name}/SKILL.md`] = body;
  const repo = repoFixture(files);
  const root = tmp('requests');
  const intake = await I();
  const q = O().queueOf({ issues: [packIssue(21, Object.keys(skills).map((n) => `skills/${n}/SKILL.md`), author)], previous: null, records: {}, asOf: '2026-11-11' });
  const entry = q.requests[0];
  const dir = intake.pin({ requests: root, entry, issue: packIssue(21, Object.keys(skills).map((n) => `skills/${n}/SKILL.md`), author), remote: () => repo.dir });
  return { repo, root, dir, intake, entry };
}
function draft(dir) {
  const rec = json(path.join(dir, 'request.json'));
  const at = path.join(dir, 'specs/408-skill-measurements');
  for (const s of json(path.join(at, 'sources.json'))) {
    const f = path.join(at, s.suite), suite = json(f);
    for (const c of suite.cases) { c.prompt = `Answer in text only. A ${c.id} case for ${s.skill}.`; c.rubric = `Award 1 when the answer handles the ${c.id} case, 0 otherwise.`; }
    suite.drafted_from = 'SKILL.md and README'; delete suite.drafted;
    fs.writeFileSync(f, JSON.stringify(suite, null, 2) + '\n');
  }
  return rec;
}

test('781 AC-5, AC-6, AC-7: a pinned pack plans one attempt per text skill per model with every constant; plants', async () => {
  const { dir, intake } = await request();
  const rec = json(path.join(dir, 'request.json'));
  assert.deepEqual(rec.skills.map((s) => [s.skill, s.measurable]), [['alpha', true], ['find-skills', false]]);
  assert.throws(() => intake.plan({ request: dir }), code('SUITE_NOT_DRAFTED'));
  draft(dir);
  const plan = intake.plan({ request: dir });
  assert.equal(plan.execution.attempts.length, 2, 'alpha on two models; the router plans none');
  assert.deepEqual(plan.execution.attempts.map((a) => a.protocol.model), [HAIKU, SONNET]);
  for (const a of plan.execution.attempts) {
    const p = a.protocol;
    assert.equal(a.attempt_id, sha256(JSON.stringify(p)));
    assert.deepEqual([p.judge, p.samples, p.draws, p.arms, p.capture], [HAIKU, 5, 10, 3, 'text']);
  }
  assert.equal(plan.cap_usd, 50); assert.ok(plan.totals.estimate_usd <= 50);
  assert.deepEqual(plan.not_measurable.map((s) => s.skill), ['find-skills']);
  R().readPlan({ request: dir });
  const bytes = fs.readFileSync(path.join(dir, 'plan.json'));
  const plant = (mutate) => { const p = JSON.parse(bytes); mutate(p); fs.writeFileSync(path.join(dir, 'plan.json'), JSON.stringify(p, null, 2) + '\n'); try { return R().readPlan({ request: dir }); } finally { fs.writeFileSync(path.join(dir, 'plan.json'), bytes); } };
  const reid = (a) => { a.attempt_id = sha256(JSON.stringify(a.protocol)); };
  assert.throws(() => plant((p) => { for (const a of p.execution.attempts) { a.protocol.judge = SONNET; reid(a); } p.judge = SONNET; }), code('PLAN_BINDING'), 'plant: the judge moved');
  assert.throws(() => plant((p) => { p.arms = 2; }), code('PLAN_BINDING'), 'plant: two arms');
  assert.throws(() => plant((p) => { for (const a of p.execution.attempts) { a.protocol.samples = 4; reid(a); } }), code('PLAN_BINDING'), 'plant: four judge samples');
  assert.throws(() => plant((p) => { p.execution.attempts.pop(); p.rows.pop(); }), code('PLAN_BINDING'), 'plant: one model left out');
  assert.throws(() => plant((p) => { p.cap_usd = 51; }), code('PLAN_BINDING'), 'plant: cap 51');
  assert.throws(() => plant((p) => { p.totals.estimate_usd = 50.01; }), code('OVER_CAP'), 'plant: an estimate over the cap at the driver');
  // A suite edited after the plan.
  const at = path.join(dir, 'specs/408-skill-measurements'), src = json(path.join(at, 'sources.json'))[0], sf = path.join(at, src.suite), sb = fs.readFileSync(sf);
  fs.writeFileSync(sf, sb.toString().replace('A normal case', 'A normal  case'));
  try { assert.throws(() => R().readPlan({ request: dir }), code('SUITE_BINDING')); } finally { fs.writeFileSync(sf, sb); }
});

test('781 AC-8, AC-17: an estimate over USD 50 writes no plan; a re-run over the cap refuses', async () => {
  const many = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`s${i}`, skillText(`s${i}`)]));
  const { dir, intake } = await request({ skills: many });
  draft(dir);
  // Twelve skills fit on Haiku 5.5 and Sonnet 5.5; on Fable 5.1, at about USD 6 a skill, they do not.
  const plan = intake.plan({ request: dir });
  assert.ok(plan.totals.estimate_usd < 50, String(plan.totals.estimate_usd));
  assert.throws(() => intake.plan({ request: dir, models: ['claude-fable-5-1'], out: path.join(dir, 'plan-fable.json') }), code('OVER_CAP'));
  assert.equal(fs.existsSync(path.join(dir, 'plan-fable.json')), false, 'no plan is written');
  const rec = json(path.join(dir, 'request.json')); rec.state = 'published'; fs.writeFileSync(path.join(dir, 'request.json'), JSON.stringify(rec, null, 2) + '\n');
  const r = intake.rerun({ requests: path.dirname(dir), model: 'claude-fable-5-1' });
  assert.deepEqual(r.map((x) => [x.request, x.status]), [[rec.request, 'OVER_CAP']]);
});

test('781 AC-13, AC-17: a stub run publishes a box for every attempt, the router\'s words and the prepared comments', async () => {
  const { dir, intake, entry, repo } = await request({ author: 'No' });
  draft(dir);
  const plan = intake.plan({ request: dir });
  const inputs = tmp('inputs'); intake.inputs({ request: dir, out: inputs, remote: () => repo.dir });
  for (const a of plan.execution.attempts) assert.ok(fs.existsSync(path.join(inputs, a.attempt_id + '.md')), 'an input per attempt');
  const check = R().preflight(R().readPlan({ request: dir }), inputs);
  assert.equal(check.problem, null, JSON.stringify(check.rows));
  // F-3, AC-7: skill bytes that differ from the pin read SKILL_BYTES, at the intake and at the driver.
  const planted = path.join(tmp('plan'), 'plan.json'), pp = json(path.join(dir, 'plan.json'));
  pp.execution.attempts[0].protocol.skill_sha256 = 'e'.repeat(64);
  fs.writeFileSync(planted, JSON.stringify(pp));
  assert.throws(() => intake.inputs({ request: dir, out: tmp('inputs'), remote: () => repo.dir, file: planted }), code('SKILL_BYTES'), 'plant: the intake fetches bytes that are not the pin');
  const first = path.join(inputs, plan.execution.attempts[0].attempt_id + '.md'), pinned = fs.readFileSync(first);
  fs.writeFileSync(first, Buffer.concat([pinned, Buffer.from('\nOne more line.\n')]));
  try {
    assert.equal(R().preflight(R().readPlan({ request: dir }), inputs).problem, 'SKILL_BYTES', 'plant: an input that is not the pinned bytes, at the preflight');
    await assert.rejects(R().runCampaign({ request: dir, campaignRoot: tmp('changed'), inputs, evalHome: tmp('eval-unused') }), code('SKILL_BYTES'), 'plant: the driver refuses before any call');
  } finally { fs.writeFileSync(first, pinned); }
  const home = tmp('eval'); fs.mkdirSync(path.join(home, '.claude'), { recursive: true }); fs.writeFileSync(path.join(home, '.claude/settings.json'), JSON.stringify(SETTINGS));
  const croot = tmp('campaign');
  // Without the stub and without --execute, nothing runs (spec 613's NO_SPEND, read at the call).
  delete process.env.DRIFTPROOF_STUB;
  const paid = R().runCampaign({ request: dir, campaignRoot: tmp('nospend'), inputs });
  process.env.DRIFTPROOF_STUB = '1';
  await assert.rejects(paid, code('NO_SPEND'));
  const m = await R().runCampaign({ request: dir, campaignRoot: croot, inputs, evalHome: home });
  assert.equal(m.stub, true);
  assert.equal(m.outcomes.filter((o) => o.status === 'receipt').length, plan.execution.attempts.length, JSON.stringify(m.outcomes.map((o) => o.reason)));
  // The stub run logged the checkout's HEAD; the temporary request is not in git, so the recorded head
  // is served from disk as git would serve that commit (spec 613 A-613-3's fixture reader).
  const reader = { head: () => null, isAncestor: () => true, show: (h, file) => (fs.existsSync(path.join(ROOT, file)) ? fs.readFileSync(path.join(ROOT, file)) : null) };
  // Receipt paths in the view are relative to `root`; under a temporary campaign root, to `/`.
  const view = intake.publish({ request: dir, campaignRoot: croot, reader, root: '/' });
  const html = M().requestPage(view);
  assert.deepEqual(boxProblems(html, '/', view), []);
  assert.equal(boxes(html).length, 4, 'two skills on two models, the router included');
  assert.ok(text(html).includes(NOT_AUTHOR));
  const dropped = /<div class="offer-box"[^>]*data-skill="alpha"[^>]*data-model="claude-haiku-5-5"[^>]*>[\s\S]*?<\/div>/.exec(html)[0];
  const every = (h) => plan.execution.attempts.filter((a) => !new RegExp(`data-skill="${a.protocol.skill}"[^>]*data-model="${a.protocol.model}"`).test(h)).map((a) => a.attempt_id);
  assert.deepEqual(every(html), []);
  assert.notDeepEqual(every(html.replace(dropped, '')), [], 'plant: a box left off the page');
  // The same boxes land on the skill's own page under /skills/ (the comment of 10 Nov 18:03, "Pages").
  const rows = M().skillRows(view);
  assert.deepEqual(rows.map((r) => [r.id.page, r.id.path, r.row.model]), [['example-owner/example-pack/alpha', 'skills/alpha', HAIKU], ['example-owner/example-pack/alpha', 'skills/alpha', SONNET]]);
  assert.deepEqual(boxProblems(rows.map((r) => r.row.markup).join(''), '/'), []);
  // The comments: received, queued and published with the page link; refused with its reason.
  const next = O().queueOf({ issues: [packIssue(21, ['skills/alpha/SKILL.md'])], previous: { requests: [entry] }, records: { [entry.request]: { state: 'published' } }, asOf: '2026-11-12' });
  const published = O().commentsFor({ requests: [entry] }, next);
  assert.ok(published.some((c) => c.kind === 'published' && c.body.includes(`/measure/requests/${String(entry.request).padStart(3, '0')}/`)));
  const refusedQ = O().queueOf({ issues: [packIssue(30, Array.from({ length: 21 }, (_, i) => `s${i}/SKILL.md`))], previous: null, records: {}, asOf: '2026-11-12' });
  const refused = O().commentsFor(null, refusedQ).find((c) => c.kind === 'refused');
  const commentHits = (c, q) => (c.body.includes(q.requests[0].reason) ? [] : ['a refusal without its reason']);
  assert.deepEqual(commentHits(refused, refusedQ), []);
  assert.notDeepEqual(commentHits({ ...refused, body: refused.body.replace(refusedQ.requests[0].reason, '') }, refusedQ), [], 'plant: the reason dropped');
});
