// SPDX-License-Identifier: Apache-2.0
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { receipts } = require('../scripts/build-receipt-pages');
const { sealReceipt, validateReceipt, verifyReceiptHash } = require('../lib/receipt');
const { receiptVerdict, placeboReading } = require('../lib/verdict');
const all = receipts();
const W = () => require('../lib/reading-words');
const B = () => require('../scripts/published-badges');
const clone = x => structuredClone(x);
// A-815-2, issue 830: isolated output fixtures explicitly list their subjects.
const fixtureSubjects = rows => [...new Map(rows.map(r => [r.skill_key, {page:'fixture/skills/'+r.badge_slug,name:r.skill,hashes:rows.filter(x=>x.skill_key===r.skill_key).map(x=>x.receipt_hash)}])).values()];
const publicHashes = new Set();
const skillList = fs.readFileSync(path.join(__dirname,'../docs/skills/index.html'),'utf8');
for (const m of skillList.matchAll(/class="skill-name" href="([^"]+)"/g)) {
  const html = fs.readFileSync(path.join(__dirname,'../docs',m[1],'index.html'),'utf8').replace(/<section class="skill-badges">[\s\S]*?<\/section>/g,'');
  for (const h of html.matchAll(/href="(?:https:\/\/driftproofhq\.com)?\/r\/([a-f0-9]{64})\/"/g)) publicHashes.add(h[1]);
  for (const r of html.matchAll(/data-receipt="((?:receipts|index-receipts)\/[^"]+\.json)"/g)) publicHashes.add(JSON.parse(fs.readFileSync(path.join(__dirname,'..',r[1]),'utf8')).receipt_hash);
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function expected(r) {
  const v = r.placebo ? placeboReading(r) : receiptVerdict(r);
  const key = v.reading || v.verdict;
  const n = v.cases.filter(c => c.state === (['BELOW_PLACEBO','REGRESSED'].includes(key) ? 'separated-down' : 'separated-up')).length;
  const m = v.cases.length;
  return ({ABOVE_PLACEBO: 'beat the fake on '+n+' of '+m+' tasks, worse on none', NO_DIFFERENCE: 'did not beat the fake on '+m+' tasks', BELOW_PLACEBO: 'worse than the fake on '+n+' of '+m+' tasks', PASSED: 'better than without it on '+n+' of '+m+' tasks, worse on none', NO_EFFECT: 'no different from without it on '+m+' tasks', REGRESSED: 'worse than without it on '+n+' of '+m+' tasks', INCONCLUSIVE: 'cannot tell', UNDERPOWERED: 'cannot tell', NOT_MEASURED: null})[key];
}
test('815 AC-1/2/3 shared words read validated sealed cases across the archive', () => {
  let measured = 0;
  for (const {receipt:r} of all) {
    const got = W().readingOf(r);
    if (got.text === null) continue;
    measured++;
    assert.equal(got.text, expected(r));
    const reading = r.placebo ? placeboReading(r) : receiptVerdict(r);
    assert.equal(got.tasks, reading.cases.length);
    assert.equal(got.reading, reading.reading || reading.verdict);
    assert.ok(validateReceipt(r).valid && verifyReceiptHash(r));
    const svg = B().svg(B().rowOf({rel:'receipts/fixture.json',receipt:r}));
    const oracle = text => assert.ok(text.includes(esc(got.text)), 'reading and task counts');
    oracle(svg);
    assert.throws(() => oracle(svg.replaceAll(esc(got.text), 'wrong reading')), /reading and task counts/);
  }
  assert.ok(measured > 100);
});
test('815 AC-1 refusals cannot mint a badge; hash and schema plants', () => {
  const source = all.find(x => x.receipt.placebo && receiptVerdict(x.receipt).verdict !== 'NOT_MEASURED').receipt;
  const bad = clone(source); bad.run.model_id += '-changed';
  assert.throws(() => W().readingOf(bad), /HASH/);
  const invalid = clone(source); invalid.run.date_utc = 'not a date'; sealReceipt(invalid);
  assert.throws(() => W().readingOf(invalid), /SCHEMA/);
  const declared = clone(source); declared.verification_level = 'DECLARED'; sealReceipt(declared);
  assert.equal(W().readingOf(declared).text, null);
  assert.equal(B().svg(B().rowOf({rel:'receipts/fixture.json',receipt:declared})), null);
  for (const x of all.filter(x => /^0\.(?:[1-5]|3\.1)$/.test(x.receipt.schema_version))) assert.equal(W().readingOf(x.receipt).text,null);
});
test('815 AC-2 fake judge mismatch never falls back to the baseline reading', () => {
  const r = clone(all.find(x => x.receipt.placebo && placeboReading(x.receipt).reading !== 'NOT_MEASURED').receipt);
  const p = r.results.cases.find(c => c.mode === 'placebo');
  p.judge.model_id = 'different-model'; sealReceipt(r);
  // A schema/consistency refusal or a NOT_MEASURED reading is safe; a baseline badge is not.
  try { assert.equal(W().readingOf(r).text, null); } catch (e) { assert.match(e.message,/SCHEMA/); }
});
test('815 AC-4 list covers all published receipts, excludes NVIDIA and checks duplicate hashes', () => {
  const list = B().catalogue();
  for (const {receipt:r} of all) assert.equal(list.filter(x => x.receipt_hash === r.receipt_hash).length,1);
  assert.ok(list.some(x => x.source === 'skill-placebo'));
  assert.ok(list.every(x => x.source !== 'nvidia' && !x.file.includes('-draft/')));
  for (const row of list) {
    assert.ok(row.skill && row.model && row.date && row.reading && row.receipt_hash && row.receipt_url);
    if (row.source === 'skill-placebo') assert.equal(row.text,null);
    else assert.equal(row.receipt_url,'https://driftproofhq.com/r/'+row.receipt_hash+'/');
  }
  const x = all[0], bad = clone(x); bad.receipt.run.model_id += '-changed';
  assert.throws(() => B().catalogue({entries:[x,bad],imports:[]}), /HASH|COPY/);
  assert.equal(B().catalogue({entries:[{...x,rel:'index-receipts/nvidia/fixture.json'}],imports:[]}).length,0);
  const imported = clone(x); imported.receipt.run.source = 'imported/nvidia-cards'; sealReceipt(imported.receipt);
  assert.equal(B().catalogue({entries:[imported],imports:[]}).length,0);
  const sp = list.find(row => row.source === 'skill-placebo');
  const promoted = JSON.parse(fs.readFileSync(path.join(__dirname,'..',sp.file),'utf8'));
  promoted.verification_level = 'TESTED'; sealReceipt(promoted);
  assert.throws(()=>B().rowOf({rel:sp.file,receipt:promoted}),/SOURCE|SCHEMA/);
});
test('815 AC-5 latest selection is per model, deterministic, and never falls back', () => {
  const row = B().catalogue().find(r => r.text);
  const rows = [
    {...row, model:'a',date:'2026-11-12T23:00:00Z',receipt_hash:'a'.repeat(64)},
    {...row, model:'b',date:'2026-11-13T00:00:00Z',receipt_hash:'b'.repeat(64)},
    {...row, model:'a',date:'2026-11-14T00:00:00Z',receipt_hash:'c'.repeat(64),text:null,reading:'NOT_MEASURED'},
  ];
  const got = B().select(rows);
  assert.equal(got.latest.receipt_hash,rows[2].receipt_hash);
  assert.deepEqual(got,B().select([...rows].reverse()));
  assert.equal(got.models.find(r=>r.model==='b').receipt_hash,rows[1].receipt_hash);
  const tied = rows.map(r=>({...r,date:rows[0].date}));
  assert.equal(B().select(tied).latest.receipt_hash,'a'.repeat(64));
});
test('815 AC-6 SVG, alt text and snippet agree and escape hostile text', () => {
  const row = B().catalogue().find(r => r.text && r.source === 'driftproof' && r.badge_page_url);
  const title = B().title(row);
  const svg = B().svg(row), html = B().snippets([row]);
  assert.ok(svg.includes('<title>'+esc(title)+'</title>'));
  assert.ok(svg.includes('href="'+row.receipt_url+'"'));
  assert.ok(html.includes('alt="'+esc(title)+'"'));
  assert.ok(html.includes('](https://driftproofhq.com'+B().basePath(row)+'latest/)'));
  const newer = {...row,date:'2026-11-16T00:00:00Z',receipt_hash:'f'.repeat(64),receipt_url:'https://driftproofhq.com/r/'+'f'.repeat(64)+'/'};
  const out = B().outputs([row,newer],{subjects:fixtureSubjects([row,newer])});
  assert.ok(out.get(B().basePath(row).slice(1)+'latest/index.html').includes(newer.receipt_url));
  assert.ok(!out.get(B().basePath(row).slice(1)+'latest/index.html').includes(row.receipt_url));
  const hostile = {...row,model:'x"><script>bad</script>'};
  assert.ok(!B().svg(hostile).includes('<script>'));
  assert.ok(!B().modelPath(hostile).includes('<'));
});
test('815 AC-3 receipt pages and offer boxes use the shared reading', () => {
  const x = all.find(x => x.receipt.placebo && W().readingOf(x.receipt).text);
  const want = W().readingOf(x.receipt).text;
  assert.ok(require('../scripts/build-receipt-pages').page(x).html.includes(esc(want)));
  assert.equal(require('../scripts/offer').readingOf(x.receipt).placebo_line,want);
});

test('815 AC-7 generated file checks detect missing, changed and extra badges', () => {
  const root = fs.mkdtempSync(path.join(process.env.TMPDIR || '/var/tmp','badge-815-'));
  try {
    const row = B().catalogue().find(r=>r.badge_latest_url);
    for (const [rel,html] of B().outputs([row],{subjects:fixtureSubjects([row])})) if (rel.endsWith('.html')) assert.equal(require('../scripts/build-head-tags').applyHeadTags(html,rel),html,'head tags are stable: '+rel);
    B().build({root,subjects:fixtureSubjects([row]),rows:[row]});
    B().build({root,subjects:fixtureSubjects([row]),rows:[row],check:true});
    const file = path.join(root,'docs',B().modelPath(row));
    const bytes = fs.readFileSync(file);
    fs.unlinkSync(file);
    assert.throws(()=>B().build({root,subjects:fixtureSubjects([row]),rows:[row],check:true}),/STALE/);
    fs.writeFileSync(file,Buffer.concat([bytes,Buffer.from('changed')]));
    assert.throws(()=>B().build({root,subjects:fixtureSubjects([row]),rows:[row],check:true}),/STALE/);
    fs.writeFileSync(file,bytes);
    fs.writeFileSync(path.join(path.dirname(file),'extra.svg'),'extra');
    assert.throws(()=>B().build({root,subjects:fixtureSubjects([row]),rows:[row],check:true}),/STALE/);
    fs.unlinkSync(path.join(path.dirname(file),'extra.svg'));
    fs.writeFileSync(path.join(path.dirname(file),'extra.json'),'extra');
    assert.throws(()=>B().build({root,subjects:fixtureSubjects([row]),rows:[row],check:true}),/STALE/);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});

test('815 AC-8/9 readable stable names follow skill names and published context provenance', () => {
  const rows = B().catalogue(), tdd = rows.find(r=>r.skill==='tdd' && r.model==='claude-sonnet-5-5');
  assert.equal(B().latestPath(tdd),'/badges/tdd.svg');
  assert.equal(B().basePath(tdd),'/badges/tdd/');
  assert.equal(B().modelPath(tdd),'/badges/tdd/claude-sonnet-5-5.svg');
  const picks = JSON.parse(fs.readFileSync(path.join(__dirname,'../receipts/report-016/manifest.json'),'utf8')).picks;
  for (const pick of picks) {
    const row = rows.find(r=>r.skill_key==='context:'+pick.sha256);
    const slug = 'report-016-'+pick.repository.split('/')[1].toLowerCase()+'-'+path.basename(pick.path).toLowerCase().replace('.', '-');
    assert.equal(row.badge_slug,slug);
    assert.equal(B().basePath(row),'/badges/'+slug+'/');
    const subjectRows=rows.filter(r=>r.skill_key===row.skill_key);
    const html=B().outputs(subjectRows).get('badges/'+slug+'/index.html');
    assert.equal(!!html,subjectRows.some(r=>publicHashes.has(r.receipt_hash)));
    if(html)assert.ok(!html.includes(pick.sha256));
  }
  assert.deepEqual(B().catalogue({entries:[...all].reverse()}),rows);
  const unknown = clone(all.find(x=>x.receipt.skill.unit==='context_file'));
  unknown.receipt.skill.content_hash='a'.repeat(64); sealReceipt(unknown.receipt);
  assert.throws(()=>B().catalogue({entries:[unknown],imports:[]}),/BADGE_CONTEXT/);
});
test('815 AC-10 collisions are refused before writing any output', () => {
  const source = all.find(x=>x.receipt.skill.name==='tdd');
  const changed = (name,model=source.receipt.run.model_id) => {
    const x=clone(source);x.receipt.skill.name=name;x.receipt.run.model_id=model;sealReceipt(x.receipt);return x;
  };
  for (const entries of [[changed('TDD'),changed('tdd')],[changed('tdd!'),changed('tdd?')],[changed('tdd','model.a'),changed('tdd','model-a')],[changed('!!!')],[changed('tdd','latest')]]) {
    assert.throws(()=>B().catalogue({entries,imports:[]}),/BADGE_NAME/);
  }
  const root=fs.mkdtempSync(path.join(process.env.TMPDIR||'/var/tmp','badge-815-collision-'));
  try {
    const row=B().catalogue().find(r=>r.skill==='tdd');
    B().build({root,subjects:fixtureSubjects([row]),rows:[row]});
    const file=path.join(root,'docs/badges/tdd.svg'),before=fs.readFileSync(file);
    assert.throws(()=>B().build({root,rows:[row,{...row,skill_key:'another-subject'}]}),/BADGE_NAME/);
    assert.deepEqual(fs.readFileSync(file),before);
    assert.throws(()=>B().outputs([row,{...row,badge_slug:'renamed'}]),/BADGE_NAME/);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});
test('815 AC-11 catalogue badge fields resolve and legacy hex output is removed', () => {
  const rows=B().catalogue(),out=B().outputs(rows);
  const listed=JSON.parse(out.get('data/published-receipts.json')).receipts;
  for (const row of listed) {
    assert.match(row.badge_slug,/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    for(const field of ['badge_page_url','badge_latest_url','badge_model_url']) {
      assert.ok(row[field]===null || row[field].startsWith('https://driftproofhq.com/badges/'));
      if(row[field]===null)continue;
      const rel=new URL(row[field]).pathname.slice(1);
      assert.ok(out.has(rel.endsWith('/')?rel+'index.html':rel),field+': '+rel);
    }
    const selected=B().select(rows.filter(r=>r.skill_key===row.skill_key));
    for(const [field,target] of [['badge_latest_url',selected.latest],['badge_model_url',selected.models.find(r=>r.model===row.model)]]) {
      assert.equal(row[field]===null,!(rows.some(r=>r.skill_key===row.skill_key && publicHashes.has(r.receipt_hash)) && target.text));
      if(row[field])assert.ok(out.get(new URL(row[field]).pathname.slice(1)).includes('data-receipt-hash="'+target.receipt_hash+'"'));
    }
  }
  const root=fs.mkdtempSync(path.join(process.env.TMPDIR||'/var/tmp','badge-815-legacy-'));
  try {
    const dir=path.join(root,'docs/badges/skills/736b696c6c');fs.mkdirSync(dir,{recursive:true});
    fs.writeFileSync(path.join(dir,'latest.svg'),'old');
    const keep=path.join(root,'docs/badges/commit-message-conventions.json');fs.writeFileSync(keep,'keep');
    B().build({root,subjects:fixtureSubjects([rows.find(r=>r.skill==='tdd')]),rows:[rows.find(r=>r.skill==='tdd')]});
    assert.equal(fs.existsSync(path.join(dir,'latest.svg')),false);
    assert.equal(fs.readFileSync(keep,'utf8'),'keep');
    B().build({root,subjects:fixtureSubjects([rows.find(r=>r.skill==='tdd')]),rows:[rows.find(r=>r.skill==='tdd')],check:true});
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});
