#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';
// Issue 694. Payloads are fixed at build time; the island never computes a finding.
const fs = require('node:fs');
const path = require('node:path');
const { plainOf } = require('../lib/plain');
const { validateReceipt, verifyReceiptHash } = require('../lib/receipt');
const { humanModelName } = require('./model-names');
const policy = require('../lib/report-015-publication');
const ROOT = path.resolve(__dirname, '..');
const ORIGIN = 'https://driftproofhq.com';
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
function sealed(r) {
  if (!validateReceipt(r).valid || !verifyReceiptHash(r)) throw Error('SEND_RECEIPT_SEAL');
}
function cardOf(hash, report) {
  const {cardFor}=require('./build-head-tags');
  const receipt=cardFor('r/'+hash+'/index.html');
  if(receipt.includes('/cards/receipt-'))return receipt;
  if(report) {const card=cardFor('reports/'+report+'/index.html');if(card.includes('/cards/report-'))return card;}
  return null;
}
function reportPayload(report, row) {
  const sugar = require('./sugar-pill-page');
  const r = row.receipt;
  if(!r || !validateReceipt(r).valid || !verifyReceiptHash(r)) return {title: row.skill, text: 'Report '+report+', '+row.skill+': This attempt has no valid sealed receipt. Report: '+ORIGIN+'/reports/'+report+'/', card:null};
  sealed(r);
  const {placeboReading,placeboLine}=require('../lib/verdict');
  const reading=placeboReading(r);
  if(reading.reading!==row.reading.placebo || placeboLine(reading)!==row.reading.placebo_line)throw Error('SEND_READING_BINDING');
  const finding=sugar.fakeSentenceOf(reading.reading,row.reading.placebo_line);
  if(!finding)throw Error('SEND_READING_WORDS');
  const none=row.router?policy.LABEL+'. '+policy.REASON:plainOf(r).sentence;
  const text=['On '+humanModelName(r.run.model_id)+', judged by '+humanModelName(r.run.judge.model_id)+', '+row.skill+' ('+row.repository+'), Report '+report+', '+r.run.date_utc.slice(0,10)+'.', finding, 'Against no skill: '+none,
    ...sugar.caveatsOf(report).map(p=>p.text), row.handoffNote,
    'Receipt: '+ORIGIN+'/r/'+r.receipt_hash+'/'].filter(Boolean).join(' ');
  return {title:row.skill+' · Report '+report,text,card:cardOf(r.receipt_hash,report)};
}
function reportCaveats(report) {
  if(!report)return [];
  const row=JSON.parse(fs.readFileSync(path.join(ROOT,'docs/data/report-summaries.json'),'utf8')).reports[report];
  if(!row)throw Error('SEND_REPORT_CAVEATS');
  return row.points.filter(p=>p.lead!=='What we found.').map(p=>p.text);
}
function skillPayload({receipt:r,name,model,source,reading,caveats,href,report}) {
  sealed(r);
  if(!reading || !caveats?.length)throw Error('SEND_SKILL_CONTEXT');
  const judge=r.run.judge?.model_id;
  const judgeName=judge && judge!=='unknown'?humanModelName(judge):null;
  const text=['On '+model+(judgeName?', judged by '+judgeName:', judge not stated')+', '+name+'. '+source+', '+r.run.date_utc.slice(0,10)+'.',reading,...caveats,...reportCaveats(report),'Receipt: '+new URL(href,ORIGIN).href].join(' ');
  return {title:name+' · '+source,text,card:cardOf(r.receipt_hash,report)};
}
function campaignPayload(receipt,name) {
  const P=require('../specs/408-skill-measurements/publication.cjs');
  const limit=policy.routerLimit(receipt);
  const p=plainOf(receipt);
  return skillPayload({receipt,name,model:humanModelName(receipt.run.model_id),source:'Report 015',report:'015',
    reading:limit?policy.LABEL+'. '+policy.REASON:p.sentence,
    caveats:[P.SCOPE,P.ISOLATION],href:'/r/'+receipt.receipt_hash+'/'});
}
function render(p) {
  return '<div class="send-result" data-island="send-result" data-share-text="'+esc(p.text)+'" data-share-title="'+esc(p.title)+'"'+(p.card?' data-share-card="'+esc(p.card)+'"':'')+'>'
    +'<button type="button" class="send-result-button" data-send hidden>Send this result</button>'
    +'<details class="send-preview"><summary>Preview and copy this result</summary><div class="send-paper"><p class="send-eyebrow">The finding, with its limits</p>'
    +'<div class="send-actions"><button type="button" data-copy hidden>Copy</button>'
    +(p.card?'<button type="button" data-share-image hidden>Share with image</button><a data-card href="'+esc(p.card)+'">View card image</a>':'')
    +'</div><p class="send-status" data-status aria-live="polite"></p><p data-preview>'+esc(p.text)+'</p>'
    // Issue 711: a router preview quotes the router label, so it links the amendment that sets it (spec 435's census).
    +(p.text.includes(policy.LABEL)?'<p class="send-note"><a href="'+policy.AMENDMENT+'">Why a router gets no verdict: Report 015 Amendment 1</a></p>':'')
    +'<p class="send-note">Keep this whole message together so the limits travel with the result.</p></div></details></div>';
}
function controls(html) {
  const {tokenize}=require('./html-text');
  const decode=s=>s.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
  return [...tokenize(html)].filter(n=>n.type==='start').map(n=>Object.fromEntries(n.attrs)).filter(a=>a['data-island']==='send-result').map(a=>({text:decode(a['data-share-text']),title:decode(a['data-share-title']),card:a['data-share-card']?decode(a['data-share-card']):null}));
}
function check() {
  const assert=require('node:assert/strict');
  for(const n of ['017','018']) {
    const b=require('./prepare-report-'+n);
    const c=b.readCampaign(b.parse([]));
    assert.deepEqual(controls(fs.readFileSync(path.join(ROOT,'docs/reports',n,'index.html'),'utf8')),c.rows.map(r=>reportPayload(n,r)));
  }
  // The existing skill builder verifies every byte through the admitted readers.
  // It is an async ES module; keep this command's check synchronous in a child.
  const {execFileSync}=require('node:child_process');
  execFileSync(process.execPath,['scripts/build-skill-index.mjs','--check'],{cwd:ROOT,timeout:1800000,stdio:'pipe'});
  for(const file of fs.readdirSync(path.join(ROOT,'docs/skills'),{recursive:true}).filter(f=>f.endsWith('/index.html'))) {
    const html=fs.readFileSync(path.join(ROOT,'docs/skills',file),'utf8');
    const readings=(html.match(/<article class="skill-row"/g)||[]).length;
    assert.ok(readings>0,file+': at least one reading');
    assert.equal(controls(html).length,readings,file+': one control per reading');
    for(const payload of controls(html)) assert.doesNotMatch(payload.text,/case rule:|case plan:|Draws needed:|ABOVE_PLACEBO|BELOW_PLACEBO|DECLARED/,file+': plain finding words');
  }
  return true;
}
module.exports={reportPayload,skillPayload,campaignPayload,render,controls,check};
if(require.main===module) {
  if(process.argv.slice(2).join(' ')!=='--check')throw Error('Use the report and skill builders to write pages; use --check here.');
  check();console.log('send result: all report and skill payloads match their readers');
}
