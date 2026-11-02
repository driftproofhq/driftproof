// SPDX-License-Identifier: Apache-2.0
'use strict';
// Issue 642 (spec 627 A-627-7, spec 435 A-435-22): the skills whose whole text only calls another
// skill. Maverick's ruling of 2 Nov 2026 keeps them in the counts and adds a note. The texts are the
// committed panel inputs, each checked against Report 017's frozen plan pin, and each must pass the
// rule; Report 015's receipts for the same skills are found by their sealed campaign source.
const fs=require('node:fs'),path=require('node:path');
const {sha256}=require('../lib/canonical');
const {verifyReceiptHash}=require('../lib/receipt');
const CAMPAIGN='receipts/report-017c',PANEL='receipts/report-017-panel',SOURCES='specs/408-skill-measurements/sources.json';
// The two Report 017 attempts, grill-me and grill-with-docs, by attempt id.
const ATTEMPTS=['9ad7ac527a21f178392b4ae9d146922b7ad58ee6ca8dcef4f8d5172f95cdb027','bfc0fd31bf2c53d679e22d467a049c6f8a5e2209265a755d14c5d2ca68a1ef02'];
const need=(ok,code)=>{if(!ok)throw Object.assign(Error(code),{code});};
// The rule: after YAML front matter, the body is one or more sentences, each an instruction to call
// the Skill tool that names only the skills to call.
const FRONT=/^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;
const NAME='["“\'][A-Za-z0-9][\\w:-]*["”\']';
const CALL=new RegExp('^(?:Call|Invoke|Use) the Skill tool(?: (?:once|twice|\\d+ times))?,? (?:with|for|on) '+NAME+'(?:(?:, and |, | and )'+NAME+')*\\.$');
function handsOffOnly(text){
 const front=FRONT.exec(String(text));if(!front)return false;
 const body=String(text).slice(front[0].length).trim();
 return body!==''&&body.split(/(?<=\.)\s+/).every(s=>CALL.test(s));
}
// Each named attempt's committed text: present, the plan's pinned bytes, and a hand-off.
function handoffTexts({plan,panelDir,ids}){
 return ids.map(id=>{
  const a=plan.execution.attempts.find(x=>x.attempt_id===id);need(a,'HANDOFF_BINDING');
  const file=path.join(panelDir,id+'.md');need(fs.existsSync(file),'HANDOFF_INPUT');
  const bytes=fs.readFileSync(file);need(sha256(bytes)===a.protocol.skill_sha256,'HANDOFF_BINDING');
  need(handsOffOnly(bytes.toString('utf8')),'HANDOFF_RULE');
  return {attempt_id:id,repository:a.protocol.repository,skill:a.protocol.skill,sha256:a.protocol.skill_sha256};
 });
}
// The committed texts, read against Report 017's frozen plan.
function committed(root){return handoffTexts({plan:JSON.parse(fs.readFileSync(path.join(root,CAMPAIGN,'plan.json'),'utf8')),panelDir:path.join(root,PANEL),ids:ATTEMPTS});}
// A receipt whose sealed campaign source names one of these skills, with that text's pinned hash,
// which is also spec 408's sources.json pin. No receipt hash is listed.
function handoffReceipt(receipt,texts,sources){
 const cases=receipt&&receipt.results&&Array.isArray(receipt.results.cases)?receipt.results.cases:[];
 const source=cases[0]&&cases[0].generation&&cases[0].generation.issue408&&cases[0].generation.issue408.source;
 const t=source&&texts.find(x=>x.repository===source.repository&&x.skill===source.skill);
 if(!t)return null;
 const pin=sources.find(x=>x.repository===source.repository&&x.skill===source.skill);
 need(verifyReceiptHash(receipt)&&(receipt.skill||{}).name===t.skill&&source.skill_sha256===t.sha256&&pin&&pin.skill_sha256===t.sha256,'HANDOFF_BINDING');
 return t;
}
// The note, in the ruling's words; `counts` names the counts the skills stay in.
function note(texts,counts){
 need(texts.length===2,'HANDOFF_BINDING');
 return 'About '+texts.map(t=>t.skill).join(' and ')+": each skill's whole text is an instruction to call another skill. These text tasks forbid tools, so each reading reflects that one-line hand-off, not the skill it calls. Both stay in "+counts+'.';
}
module.exports={ATTEMPTS,SOURCES,handsOffOnly,handoffTexts,committed,handoffReceipt,note};
