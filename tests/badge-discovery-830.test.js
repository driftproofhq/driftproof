// SPDX-License-Identifier: Apache-2.0
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const ORIGIN = 'https://driftproofhq.com';
const B = require('../scripts/published-badges');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const decode = s => s.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const text = s => decode(s.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
const main = html => /<main\b[^>]*>([\s\S]*?)<\/main>/.exec(html)?.[1] || '';
const h1 = html => text(/<h1\b[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1] || '');
const hrefs = html => [...html.matchAll(/<a\b[^>]*\bhref="([^"]+)"[^>]*>/g)].map(m => decode(m[1]).replace(ORIGIN, ''));
const hubPath = href => /^\/badges\/[^/]+\/$/.test(href);
const hubFile = rel => /^badges\/[^/]+\/index\.html$/.test(rel);
const redirectFile = rel => /^badges\/[^/]+\/[^/]+\/index\.html$/.test(rel);
function linkProblems(html, targets) {
  const got = hrefs(html);
  return targets.filter(target => !got.includes(target));
}
function llmsProblems(body) {
  return ['/badges/', '/r/', '/findings/', '/tasks/'].filter(p => !body.includes('](' + ORIGIN + p + ')'));
}
function walkHtml(dir, prefix = '') {
  return fs.readdirSync(dir, {withFileTypes:true}).flatMap(e => e.isDirectory()
    ? walkHtml(path.join(dir, e.name), prefix + e.name + '/')
    : e.name.endsWith('.html') ? [[prefix + e.name, fs.readFileSync(path.join(dir, e.name), 'utf8')]] : []);
}
let generatedPromise;
function generated() {
  if (!generatedPromise) generatedPromise = (async () => {
    const {buildSkillIndex} = await import('../scripts/build-skill-index.mjs');
    const date = /data-build-date datetime="([^"]+)"/.exec(read('docs/skills/index.html'))[1];
    const built = buildSkillIndex({root:ROOT, buildDate:date});
    return {skills:new Map(built.files.filter(f => f.path.endsWith('.html')).map(f => ['skills/' + f.path, f.bytes.toString()])), badges:B.outputs()};
  })();
  return generatedPromise;
}
function committed() {
  return {skills:new Map(walkHtml(path.join(ROOT, 'docs/skills'), 'skills/')),
    badges:new Map([...walkHtml(path.join(ROOT, 'docs/badges'), 'badges/'),
      ['data/published-receipts.json', read('docs/data/published-receipts.json')]])};
}
function listedSkills(skills) {
  const list = skills.get('skills/index.html');
  assert.ok(list, 'skill index exists');
  const paths = [...new Set(hrefs(main(list)).filter(p => /^\/skills\/(?!receipts\/).+\/$/.test(p)))];
  assert.ok(paths.length, 'public list is not empty');
  return paths.map(p => {
    const rel = p.slice(1) + 'index.html', html = skills.get(rel);
    assert.ok(html, 'listed skill page exists: ' + rel);
    return {rel, html, name:h1(html)};
  });
}
function resultIdentities(html, rows) {
  const results = main(html).replace(/<section class="skill-badges">[\s\S]*?<\/section>/g, '');
  const hashes = new Set(hrefs(results).map(p => /^\/r\/([a-f0-9]{64})\/$/.exec(p)?.[1]).filter(Boolean));
  for (const m of results.matchAll(/data-receipt="((?:receipts|index-receipts)\/[^"]+\.json)"/g)) hashes.add(JSON.parse(read(m[1])).receipt_hash);
  return new Set(rows.filter(r => hashes.has(r.receipt_hash)).map(r => r.skill_key));
}
function currentModels(rows) {
  const ordered = [...rows].sort((a,b) => Date.parse(b.date)-Date.parse(a.date) || (a.receipt_hash < b.receipt_hash ? -1 : a.receipt_hash > b.receipt_hash ? 1 : 0));
  const seen = new Set();
  return ordered.filter(row => { if (seen.has(row.model)) return false; seen.add(row.model); return true; });
}
function hubProblems(skills, badges) {
  const errors = [], linked = new Set();
  const rows = JSON.parse(badges.get('data/published-receipts.json')).receipts;
  const indexLinks = new Map([...main(badges.get('badges/index.html') || '').matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map(m => [m[1].replace(ORIGIN, ''), text(m[2])]));
  for (const skill of listedSkills(skills)) {
    const links = [...new Set(hrefs(main(skill.html)).filter(hubPath))];
    const identities = resultIdentities(skill.html, rows);
    const eligible = currentModels(rows.filter(row => identities.has(row.skill_key))).some(row => row.source === 'driftproof' && row.text);
    if (eligible && links.length !== 1) errors.push(skill.rel + ': missing own hub link or extra link');
    if (!eligible && links.length) errors.push(skill.rel + ': subject without a published badge links a hub');
    for (const href of links) {
      const rel = href.slice(1) + 'index.html', html = badges.get(rel);
      linked.add(rel);
      if (!html) { errors.push(skill.rel + ': missing hub ' + rel); continue; }
      if (h1(html) !== skill.name + ' badges') errors.push(rel + ': heading differs from skill display name');
      const title = text(/<title>([\s\S]*?)<\/title>/.exec(html)?.[1] || '');
      if (title !== skill.name + ' badges | Driftproof') errors.push(rel + ': title differs from skill display name');
      if (indexLinks.get(href) !== skill.name) errors.push(rel + ': index label differs from skill display name');
    }
  }
  for (const rel of badges.keys()) if (hubFile(rel) && !linked.has(rel)) errors.push(rel + ': hub has no listed subject');
  return errors;
}
function redirectProblems(badges, exists) {
  const errors = [];
  for (const [rel, html] of badges) {
    if (!redirectFile(rel)) continue;
    const target = /<meta\b[^>]*http-equiv="refresh"[^>]*content="0; url=([^"]+)"/.exec(html)?.[1];
    if (!/^\/r\/[a-f0-9]{64}\/$/.test(target || '')) { errors.push(rel + ': invalid receipt target'); continue; }
    if (!exists(target.slice(1) + 'index.html')) errors.push(rel + ': missing receipt page');
    if (!hrefs(main(html)).includes(target)) errors.push(rel + ': fallback differs from redirect');
  }
  return errors;
}
// Reconstruct selection from catalogue rows without calling the badge selector.
function selectionProblems(badges) {
  const errors = [];
  const rows = JSON.parse(badges.get('data/published-receipts.json')).receipts;
  const bySlug = new Map();
  for (const row of rows) {
    if (!bySlug.has(row.badge_slug)) bySlug.set(row.badge_slug, []);
    bySlug.get(row.badge_slug).push(row);
    for (const field of ['badge_page_url', 'badge_latest_url', 'badge_model_url']) {
      if (row[field] === null) continue;
      const p = new URL(row[field]).pathname.slice(1);
      if (!badges.has(p.endsWith('/') ? p + 'index.html' : p)) errors.push(row.badge_slug + ': dangling ' + field);
    }
  }
  for (const [slug, rs] of bySlug) {
    const eligible = currentModels(rs).some(row => row.source === 'driftproof' && row.text);
    if (!eligible && (badges.has('badges/' + slug + '/index.html') || rs.some(row => row.badge_page_url || row.badge_latest_url || row.badge_model_url))) errors.push(slug + ': subject without a published badge has a hub or URL');
    const ordered = [...rs].sort((a,b) => Date.parse(b.date)-Date.parse(a.date) || (a.receipt_hash < b.receipt_hash ? -1 : a.receipt_hash > b.receipt_hash ? 1 : 0));
    const selected = new Map([['latest', ordered[0]]]);
    const models = new Set();
    for (const row of ordered) if (!models.has(row.model)) {
      models.add(row.model);
      const model = row.model.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      selected.set(model, row);
    }
    for (const [model, row] of selected) {
      const redirect = badges.get('badges/' + slug + '/' + model + '/index.html');
      const svgRel = model === 'latest' ? 'badges/' + slug + '.svg' : 'badges/' + slug + '/' + model + '.svg';
      const svg = badges.get(svgRel);
      if (redirect && !redirect.includes('content="0; url=/r/' + row.receipt_hash + '/"')) errors.push(slug + '/' + model + ': wrong selected receipt');
      if (svg && !svg.includes('data-receipt-hash="' + row.receipt_hash + '"')) errors.push(slug + '/' + model + ': SVG hash differs');
      if (svg && row.text === null) errors.push(slug + '/' + model + ': refused selection has an SVG');
    }
  }
  return errors;
}
function sameSubjectProblems(skills, badges) {
  const errors = [], rows = JSON.parse(badges.get('data/published-receipts.json')).receipts;
  for (const skill of listedSkills(skills)) {
    const identities = resultIdentities(skill.html, rows);
    for (const href of hrefs(main(skill.html)).filter(hubPath)) {
      const slug = href.split('/')[2];
      const hubRows = rows.filter(r => r.badge_slug === slug);
      for (const row of hubRows) if (!identities.has(row.skill_key)) errors.push(skill.rel + ': hub joins a different subject ' + row.skill_key);
    }
  }
  return errors;
}
function clean(errors, label) { assert.equal(errors.length, 0, label + ': ' + errors.slice(0, 12).join('; ')); }

test('830 AC-12: both llms generators and committed files list the badge hub', () => {
  const L = require('../scripts/build-llms');
  for (const [label, body] of [['llms generator', L.renderLlms()], ['full generator', L.renderLlmsFull()], ['llms.txt', read('docs/llms.txt')], ['llms-full.txt', read('docs/llms-full.txt')]]) clean(llmsProblems(body), label);
});
test('830 AC-12: shared menu and footer expose badges with the result hubs', () => {
  const C = require('../scripts/site-chrome');
  for (const [label, html] of [['menu', C.NAV], ['footer', C.FOOTER]]) clean(linkProblems(html, ['/badges/', '/r/', '/skills/', '/findings/', '/reports/']), label);
});
test('830 AC-12: home, maintainer and What is Driftproof mention badges in main content', () => {
  const S = require('../scripts/build-site-pages');
  for (const [rel, html] of [['index.html', S.homepage()], ['maintainer/index.html', S.maintainerPage()], ['what-is-driftproof/index.html', require('../scripts/answer-pages').whatIsPage().main]]) {
    clean(linkProblems(main(html), ['/badges/']), rel + ' generator');
    clean(linkProblems(main(read('docs/' + rel)), ['/badges/']), rel + ' committed');
  }
});
for (const [label, load] of [['generator', generated], ['committed', committed]]) {
  test('830 AC-13/14/17: ' + label + ' hubs match listed skills and display names', async () => {
    const {skills, badges} = await load();
    clean(hubProblems(skills, badges), label);
  });
  test('830 AC-14/16: ' + label + ' hub links preserve subject identity', async () => {
    const {skills, badges} = await load();
    clean(sameSubjectProblems(skills, badges), label);
  });
  test('830 AC-15: every ' + label + ' redirect and fallback reaches an existing receipt', async () => {
    const {badges} = await load();
    assert.ok([...badges.keys()].some(redirectFile), 'redirect coverage is not empty');
    clean(redirectProblems(badges, rel => fs.existsSync(path.join(ROOT, 'docs', rel))), label);
  });
}
test('830 AC-15/16: selection, SVG hashes and catalogue URLs agree', async () => {
  clean(selectionProblems((await generated()).badges), 'generated selection');
});
test('830 AC-12/13/14: independent readers reject missing discovery and extra hubs', () => {
  const hash = 'a'.repeat(64);
  const result = '<a href="/r/' + hash + '/">Receipt</a>';
  const link = '<a href="/badges/demo/">Badges</a>';
  const row = {source:'driftproof',skill_key:'skill:demo',badge_slug:'demo',receipt_hash:hash,model:'alpha',date:'2026-11-17T00:00:00Z',text:'cannot tell',badge_page_url:null,badge_latest_url:null,badge_model_url:null};
  const skills = new Map([['skills/index.html', '<main><a href="/skills/owner/repo/demo/">demo</a></main>'], ['skills/owner/repo/demo/index.html', '<main><h1>Demo name</h1>' + result + link + '</main>']]);
  const badges = new Map([['badges/index.html', '<main><a href="/badges/demo/">Demo name</a></main>'], ['badges/demo/index.html', '<title>Demo name badges | Driftproof</title><h1>Demo name badges</h1>']]);
  badges.set('data/published-receipts.json', JSON.stringify({receipts:[row]}));
  clean(hubProblems(skills, badges), 'fixture');
  const refused = new Map(badges);
  refused.set('data/published-receipts.json', JSON.stringify({receipts:[{...row,text:null}]}));
  assert.ok(hubProblems(skills, refused).some(e => e.includes('without a published badge')));
  assert.ok(selectionProblems(refused).some(e => e.includes('without a published badge')));
  const noBadgeSkills = new Map(skills);
  noBadgeSkills.set('skills/owner/repo/demo/index.html', '<main><h1>Demo name</h1>' + result + '</main>');
  refused.delete('badges/demo/index.html');
  clean(hubProblems(noBadgeSkills, refused), 'refused subject without hub or link');
  const missing = new Map(skills); missing.set('skills/owner/repo/demo/index.html', '<main><h1>Demo name</h1>' + result + '</main>');
  assert.ok(hubProblems(missing, badges).some(e => e.includes('missing own hub')));
  const wrongName = new Map(badges); wrongName.set('badges/demo/index.html', '<title>demo badges | Driftproof</title><h1>demo badges</h1>');
  assert.ok(hubProblems(skills, wrongName).some(e => e.includes('display name')));
  const extra = new Map(badges); extra.set('badges/demo-section-removed/index.html', '<h1>Demo name badges</h1>');
  assert.ok(hubProblems(skills, extra).some(e => e.includes('no listed subject')));
  assert.deepEqual(linkProblems('', ['/badges/']), ['/badges/']);
  const llms = ['/badges/', '/r/', '/findings/', '/tasks/'].map(p => '[Hub](' + ORIGIN + p + ')').join('\n');
  clean(llmsProblems(llms), 'fixture llms');
  assert.deepEqual(llmsProblems(llms.replace('[Hub](' + ORIGIN + '/badges/)', '')), ['/badges/']);
});
test('830 AC-15/16: redirect plants reject missing, wrong and inconsistent receipts', async () => {
  const {badges} = await generated();
  const rel = [...badges.keys()].find(redirectFile), html = badges.get(rel);
  assert.ok(rel, 'redirect fixture exists');
  const target = /content="0; url=([^\"]+)"/.exec(html)[1];
  const missing = new Map([[rel, html]]);
  assert.ok(redirectProblems(missing, () => false).some(e => e.includes('missing receipt')));
  const wrongFallback = new Map([[rel, html.replaceAll(ORIGIN + target, ORIGIN + '/r/' + 'f'.repeat(64) + '/')]]);
  assert.ok(redirectProblems(wrongFallback, () => true).some(e => e.includes('fallback differs')));
  const otherTarget = [...badges].filter(([p]) => redirectFile(p)).map(([, body]) => /content="0; url=([^"]+)"/.exec(body)?.[1]).find(p => p && p !== target && fs.existsSync(path.join(ROOT, 'docs', p.slice(1), 'index.html')));
  assert.ok(otherTarget, 'wrong-target plant uses another existing receipt');
  const wrong = new Map(badges); wrong.set(rel, html.replaceAll(target, otherTarget));
  assert.ok(selectionProblems(wrong).some(e => e.includes('wrong selected receipt')));
  const svgRel = [...badges.keys()].find(p => p.endsWith('.svg'));
  const wrongSvg = new Map(badges); wrongSvg.set(svgRel, badges.get(svgRel).replace(/data-receipt-hash="[^"]+"/, 'data-receipt-hash="' + 'f'.repeat(64) + '"'));
  assert.ok(selectionProblems(wrongSvg).some(e => e.includes('SVG hash differs')));
});

test('830 AC-14/16: plants reject a mixed subject, refused SVG and dangling catalogue URL', async () => {
  const hash = 'a'.repeat(64), variantHash = 'b'.repeat(64);
  const skill = '<main><h1>Demo</h1><a href="/r/' + hash + '/">Receipt</a><a href="/badges/demo/">Badges</a></main>';
  const skills = new Map([['skills/index.html', '<main><a href="/skills/owner/repo/demo/">Demo</a></main>'], ['skills/owner/repo/demo/index.html', skill]]);
  const row = {skill_key:'skill:demo', badge_slug:'demo', receipt_hash:hash, model:'alpha', date:'2026-11-17T00:00:00Z', text:null, badge_page_url:null, badge_latest_url:null, badge_model_url:null};
  const body = rows => JSON.stringify({version:1, receipts:rows});
  const good = new Map([['data/published-receipts.json', body([row])]]);
  clean(sameSubjectProblems(skills, good), 'subject fixture');
  clean(selectionProblems(good), 'refused-only fixture');
  const mixed = new Map(good);
  mixed.set('data/published-receipts.json', body([row, {...row, skill_key:'skill:demo:section-removed:' + variantHash, receipt_hash:variantHash}]));
  assert.ok(sameSubjectProblems(skills, mixed).some(e => e.includes('different subject')));
  const promoted = new Map(good);
  promoted.set('badges/demo.svg', '<svg data-receipt-hash="' + hash + '"></svg>');
  assert.ok(selectionProblems(promoted).some(e => e.includes('refused selection has an SVG')));
  const dangling = new Map((await generated()).badges);
  const linkedRow = JSON.parse(dangling.get('data/published-receipts.json')).receipts.find(row => row.badge_page_url);
  assert.ok(linkedRow, 'dangling URL plant has a catalogue link');
  const removed = new URL(linkedRow.badge_page_url).pathname.slice(1) + 'index.html';
  assert.ok(dangling.has(removed), 'dangling URL plant removes the linked hub');
  dangling.delete(removed);
  assert.ok(selectionProblems(dangling).some(e => e.includes('dangling badge_page_url')));
});

// Issue 830 fix round 2: membership follows current selections, never name-only subjects
// or an older eligible receipt behind a refused newest run.
test('830 AC-13/14/16: no-badge subjects have no generated hubs, links or catalogue URLs', () => {
  const row = {source:'driftproof',skill:'demo',skill_key:'skill:demo',badge_slug:'demo',model:'alpha',date:'2026-11-16T00:00:00Z',text:'cannot tell',reading:'INCONCLUSIVE',receipt_hash:'a'.repeat(64),receipt_url:ORIGIN+'/r/'+'a'.repeat(64)+'/'};
  const refused = {...row,date:'2026-11-17T00:00:00Z',receipt_hash:'b'.repeat(64),text:null};
  const subjects = [{page:'owner/repo/demo',name:'Demo',hashes:[row.receipt_hash,refused.receipt_hash]}, {page:'one/repo/empty',name:'Empty',hashes:[]}, {page:'two/repo/empty',name:'Empty',hashes:[]}];
  const empty = B.outputs([row,refused], {subjects});
  assert.deepEqual([...empty.keys()].sort(), ['badges/index.html','data/published-receipts.json']);
  for (const r of JSON.parse(empty.get('data/published-receipts.json')).receipts) for (const field of ['badge_page_url','badge_latest_url','badge_model_url']) assert.equal(r[field], null, field);
  const available = {...row,model:'beta'};
  const withBadge = B.outputs([available,refused], {subjects});
  assert.ok(withBadge.has('badges/demo/index.html'), 'another model with a current badge retains the hub');
  assert.ok(withBadge.has('badges/demo/beta.svg'));
  assert.ok(!withBadge.has('badges/demo.svg'), 'refused latest never falls back');
  assert.ok(!withBadge.get('badges/index.html').includes('/badges/empty/'));
});
