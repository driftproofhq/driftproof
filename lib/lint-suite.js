// SPDX-License-Identifier: Apache-2.0
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { loadSkill } = require('./skill');
const { canonicalize } = require('./canonical');
const { validateReceipt, verifyReceiptHash, duplicateCaseRows, REGRADE_SIDECAR, SUMMARY_SIDECAR } = require('./receipt');
const { caseRubricHash } = require('./judge');
const { resolveCount } = require('./counts');
const { receiptAggregatesOnly, AGGREGATES_ONLY_LINE } = require('./verdict');
const { SKILL_MAX_FILES, SKILL_MAX_BYTES, SKILL_MAX_DEPTH } = require('../config');

const LIMITS = Object.freeze({ LINT_SUITE_BYTES: 8388608, LINT_RECEIPT_BYTES: 8388608,
  LINT_RECEIPT_TOTAL: 67108864, LINT_RECEIPT_COUNT: 64, LINT_DIRECTORY_ENTRIES: 4096,
  LINT_WORK: 2000000, LINT_OUTPUT: 2097152 });
const SCOPE = 'Offline advisory checks. No model calls or writes. These checks describe repeated words, answer text in grading fields and recorded pass/fail outcomes only.';
const HELP = 'usage: driftproof lint-suite <skill-dir> [--receipts DIR]\n' + SCOPE + '\n' +
  'Prompt advice uses the longest contiguous Unicode word run divided by the larger prompt word count. It may repeat coverage.\n' +
  'Answer text in grading fields is quoted. Model exposure was not checked.\n' +
  'History needs compatible, sealed TESTED receipts with complete paired draws and one recorded grading context.\n' +
  'No pass/fail separation in these receipts: scores may differ; future runs may differ. A seal records integrity since sealing, not authenticity.\n' +
  'Large inputs refuse with named file, work or output budgets before any report. Findings are advisory, exit 0. Invalid input exits 2; seal or schema refusal exits 4.';
function fail(message, exitCode = 2) { throw Object.assign(new Error(message), { exitCode }); }
function bound(name, value, limit = LIMITS[name]) {
  if (value > limit) fail(name + ': ' + value + ' exceeds ' + limit + '; no findings rendered.');
}
// Escape terminal controls as well as JSON delimiters. Parseable evidence keeps the original value.
function render(value) {
  return JSON.stringify(value).replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu,
    c => c.split('').map(unit => '\\u' + unit.charCodeAt(0).toString(16).padStart(4, '0')).join(''));
}
function entries(dir) {
  const handle = fs.opendirSync(dir); const out = [];
  try { let entry; while ((entry = handle.readSync())) { out.push(entry); bound('LINT_DIRECTORY_ENTRIES', out.length); } }
  finally { handle.closeSync(); }
  return out.sort((a,b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}
function regular(file) {
  const st = fs.lstatSync(file);
  if (!st.isFile() || st.isSymbolicLink()) fail('Input ' + render(path.basename(file)) + ' must be a regular file, not a link or device.');
  return st;
}
function readBounded(file, name, limit = LIMITS[name]) {
  const st = regular(file); bound(name, st.size, limit);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const actual = fs.fstatSync(fd); if (!actual.isFile()) fail('Input must be a regular file: ' + render(path.basename(file)));
    bound(name, actual.size, limit);
    const chunks = []; let count = 0;
    while (count <= limit) {
      const buf = Buffer.alloc(Math.min(65536, limit + 1 - count));
      const n = fs.readSync(fd, buf, 0, buf.length, null); if (!n) break;
      chunks.push(buf.subarray(0,n)); count += n; bound(name,count,limit);
    }
    return Buffer.concat(chunks);
  } finally { fs.closeSync(fd); }
}
function readSkill(dir) {
  const cache = new Map(); let files = 0; let bytes = 0; let inspected = 0;
  const skipDirs = new Set(['.git','node_modules','evals']);
  function walk(at, depth) {
    bound('SKILL_MAX_DEPTH',depth,SKILL_MAX_DEPTH);
    const listing = entries(at);
    inspected += listing.length;
    bound('LINT_DIRECTORY_ENTRIES', inspected);
    for (const entry of listing) {
      if (entry.name === '.DS_Store' || skipDirs.has(entry.name) && (entry.isDirectory() || entry.isSymbolicLink())) continue;
      const file = path.join(at,entry.name);
      if (entry.isSymbolicLink()) fail('Skill link refused: ' + render(path.relative(dir,file)));
      if (entry.isDirectory()) walk(file,depth+1);
      else { const st=regular(file); files++; bytes+=st.size; bound('SKILL_MAX_FILES',files,SKILL_MAX_FILES); bound('SKILL_MAX_BYTES',bytes,SKILL_MAX_BYTES); }
    }
  }
  walk(dir,0);
  const evalDir = path.join(dir,'evals'); const st=fs.lstatSync(evalDir);
  if (!st.isDirectory() || st.isSymbolicLink()) fail('evals must be a plain directory; link refused.');
  inspected += entries(evalDir).length;
  bound('LINT_DIRECTORY_ENTRIES', inspected);
  let actualBytes=0;
  const readFile = (file, encoding) => {
    if (!cache.has(file)) {
      const suite = file === path.join(dir,'evals','evals.json');
      const buf=readBounded(file,suite?'LINT_SUITE_BYTES':'SKILL_MAX_BYTES',suite?LIMITS.LINT_SUITE_BYTES:SKILL_MAX_BYTES);
      if(!suite){actualBytes+=buf.length;bound('SKILL_MAX_BYTES',actualBytes,SKILL_MAX_BYTES);} cache.set(file,buf);
    }
    return encoding ? cache.get(file).toString(encoding) : cache.get(file);
  };
  const skill = loadSkill(dir,{readFile});
  const raw=JSON.parse(cache.get(path.join(dir,'evals','evals.json')).toString('utf8'));
  return { skill, raw: Array.isArray(raw)?raw:raw.cases||raw.evals };
}
function sidecar(name, doc) {
  if(Object.hasOwn(doc,'results'))return false;
  return name.length>REGRADE_SIDECAR.suffix.length && name.endsWith(REGRADE_SIDECAR.suffix) && /^driftproof-regrade\/[0-9]+$/.test(doc.format) ||
    name.length>SUMMARY_SIDECAR.suffix.length && name.endsWith(SUMMARY_SIDECAR.suffix) && doc.format===SUMMARY_SIDECAR.format && typeof doc.format_version==='string' && /^[0-9]+$/.test(doc.format_version) ||
    name.length>'.surface.json'.length && name.endsWith('.surface.json') && doc.receipt===name.slice(0,-'.surface.json'.length)+'.json';
}
function readReceipts(dir) {
  const st=fs.lstatSync(dir);if(!st.isDirectory()||st.isSymbolicLink())fail('Receipt directory must be a plain directory, not a link.');
  const files=entries(dir).filter(e=>e.name.endsWith('.json'));bound('LINT_RECEIPT_COUNT',files.length);
  let total=0;
  for(const e of files){const st=regular(path.join(dir,e.name));bound('LINT_RECEIPT_BYTES',st.size);total+=st.size;bound('LINT_RECEIPT_TOTAL',total);}
  let actualTotal=0;const out=[];
  for(const e of files){const buf=readBounded(path.join(dir,e.name),'LINT_RECEIPT_BYTES');actualTotal+=buf.length;bound('LINT_RECEIPT_TOTAL',actualTotal);
    let r;try{r=JSON.parse(buf.toString('utf8'));}catch{fail('Invalid JSON in '+render(e.name)+'; no findings rendered.');}
    if(!r||typeof r!=='object'||Array.isArray(r)||!Object.hasOwn(r,'results')&&!Object.hasOwn(r,'receipt_hash')||sidecar(e.name,r))continue;
    let verified = false;
    try { verified = verifyReceiptHash(r); } catch { /* Unreadable seal computation is a seal refusal. */ }
    if (!verified) fail('receipt_hash seal does not verify for ' + render(e.name) + '; no findings rendered.', 4);
    if(duplicateCaseRows(r).length)fail('Duplicate or ambiguous receipt rows in '+render(e.name)+'; no findings rendered.');
    let valid = false;
    try { valid = validateReceipt(r).valid; } catch { /* No history from an unreadable schema. */ }
    if (!valid) fail('Receipt schema does not validate for ' + render(e.name) + '; no findings rendered.', 4);
    out.push({file:e.name,receipt:r});
  }
  return out;
}
const words = text => [...text.matchAll(/[\p{L}\p{N}]+/gu)].map(m=>({word:m[0].toLowerCase(),start:m.index,end:m.index+m[0].length}));
function longest(a,b) {
  let previous=new Uint32Array(b.length+1);let best={length:0,a:0,b:0};
  for(let i=0;i<a.length;i++) {const next=new Uint32Array(b.length+1);
    for(let j=0;j<b.length;j++)if(a[i].word===b[j].word){const length=next[j+1]=previous[j]+1;const ai=i-length+1,bj=j-length+1;
      if(length>best.length||length===best.length&&(ai<best.a||ai===best.a&&bj<best.b))best={length,a:ai,b:bj};}
    previous=next;
  }return best;
}
function fields(c) {return [{field:'rubric',text:c.rubric},...(c.criteria||[]).map(x=>({field:'criteria.'+x.id,text:x.description}))];}
function answerMatch(text, expected) {
  let best = null;
  if (expected) {
    let at = -1;
    while ((at = text.indexOf(expected, at + 1)) !== -1) {
      const before = [...text.slice(0, at)].pop() || '';
      const after = [...text.slice(at + expected.length)][0] || '';
      if (!/[\p{L}\p{N}]/u.test(before) && !/[\p{L}\p{N}]/u.test(after)) {
        best = { start: at, matched: expected, source: 'expected' };
        break;
      }
    }
    const a = words(text), b = words(expected);
    if (b.length) for (let i = 0; i <= a.length - b.length; i++) {
      if (b.every((w, j) => w.word === a[i + j].word)) {
        if (!best || a[i].start < best.start) best = { start: a[i].start,
          matched: text.slice(a[i].start, a[i + b.length - 1].end), source: 'expected' };
        break;
      }
    }
  }
  if (best) return { matched: best.matched, source: best.source };
  const cue = /\b(?:answer is|expected answer:|correct answer:)\s*(\S[^\r\n]*)/i.exec(text);
  return cue ? { matched: cue[1].trim(), source: 'answer-cue' } : null;
}

function reserve(skill,raw,receipts) {
  const tokens=skill.suite.cases.map(c=>words(c.prompt));let work=0,output=2048;
  const size=s=>Buffer.byteLength(render(s));
  for(let i=0;i<tokens.length;i++)for(let j=i+1;j<tokens.length;j++){
    work+=tokens[i].length*tokens[j].length; bound('LINT_WORK',work);
    output+=2*(600+size(skill.suite.cases[i].id)+size(skill.suite.cases[j].id)+Math.min(size(tokens[i].map(x=>x.word)),size(tokens[j].map(x=>x.word)))); bound('LINT_OUTPUT',output);
  }
  for(let i=0;i<tokens.length;i++){
    const c=skill.suite.cases[i];const expected=typeof raw[i].expected==='string'?raw[i].expected.trim():'';
    const e=words(expected);output+=1024+2*size(c.id);
    for(const f of fields(c)){work+=words(f.text).length*e.length;bound('LINT_WORK',work);output+=512+size(f.text)+size(f.field);bound('LINT_OUTPUT',output);}
    for(const r of receipts){output+=2048+4*size(r.file)+size(r.receipt.run.judge)+size(r.receipt.run.model_id)+2*size(c.id);bound('LINT_OUTPUT',output);}
  }
  // Exclusions and context notices are bounded too, including hostile filenames.
  output+=receipts.reduce((n,r)=>n+1024+2*size(r.file),0);
  bound('LINT_WORK',work);bound('LINT_OUTPUT',output);
  return tokens;
}
function profile(r) {
  const run=r.run, a=run.answered_by, j=run.judge;
  if(!run.model_id||!run.surface||!run.runner_version||!run.harness||!run.capture||!a||!a.isolation||!j||
    !j.model_id||!j.prompt_template_hash||!Object.hasOwn(j,'temperature')||!j.sampling||!j.surface) return null;
  const model=run.model_id,judge=j.model_id;
  if(a.reported_model!==model||a.attested!==true||!a.reported_models?.includes(model))return null;
  for(const arm of Object.values(run.arms||{})) {
    if(arm.model_id && arm.model_id!==model || arm.judge && arm.judge.model_id && arm.judge.model_id!==judge || arm.answered_by && arm.answered_by.reported_model!==model)return null;
  }
  for(const row of r.results.cases) {
    if(row.model_id && row.model_id!==model || !row.judge || row.judge.model_id!==judge)return null;
    if(row.reported_model && row.reported_model!==model)return null;
    for(const draw of row.generation?.draws||[]) {
      if(draw.status==='measured'&&draw.reported_model!==model || draw.reported_model && draw.reported_model!==model || draw.model_id && draw.model_id!==model || draw.judge?.model_id && draw.judge.model_id!==judge)return null;
    }
  }
  return {model,surface:run.surface,harness:run.harness,capture:run.capture,isolation:a.isolation,runner:run.runner_version,judge:j};
}
function complete(r,c) {
  if(r.results.aggregates?.excluded_cases?.some(x=>x.id===c.id))return false;
  for(const mode of ['with_skill','baseline']) {
    const index=r.results.cases.findIndex(x=>x.id===c.id&&x.mode===mode);if(index<0)return false;
    const row=r.results.cases[index],g=row.generation;
    if(row.case_status && row.case_status!=='completed' || !g || !g.draws?.length || row.threshold!==c.pass_threshold || row.judge?.rubric_hash!==caseRubricHash(c))return false;
    const count=resolveCount(r,index,'generations_per_arm'),judge=resolveCount(r,index,'judge_samples_per_generation');
    if(count!==g.draws.length||!Number.isInteger(judge)||judge<1||g.n_drawn!==count||g.n_measured!==count||g.n_unmeasured!==0||g.n_truncated!==0)return false;
    const indexes=new Set();
    for(const d of g.draws){if(d.status!=='measured'||d.truncated!==false||d.samples?.length!==judge||!Number.isInteger(d.draw_index)||indexes.has(d.draw_index)||d.draw_index<0||d.draw_index>=count)return false;indexes.add(d.draw_index);}
  }return true;
}
// Spec 265 AC-75: a receipt carrying the mark is never history evidence, whatever its level.
function historyReason(r) { return receiptAggregatesOnly(r) ? AGGREGATES_ONLY_LINE : null; }
function addHistory(report,skill,records) {
  const eligible=[];const seen=new Set();
  for(const rec of records) {
    const r=rec.receipt;
    let reason=null;
    if(r.run.preset)reason='quick or smoke preset';
    else if(r.verification_level!=='TESTED'||r.run.answered_by?.kind!=='model'||!r.run.answered_by.attested)reason='not TESTED model evidence';
    else if(r.skill.content_hash!==skill.contentHash||r.suite.suite_hash!==skill.suite.suiteHash||r.suite.case_count!==skill.suite.caseCount)reason='skill or suite does not match';
    if(historyReason(r))reason=historyReason(r);
    if(reason){report.notices.push(render(rec.file)+': '+reason+'; excluded from history.');continue;}
    if(seen.has(r.receipt_hash))continue;seen.add(r.receipt_hash);eligible.push(rec);
  }
  if(!eligible.length){report.history.status='no-usable-history';report.notices.push('No usable compatible history receipts.');return;}
  const profiles=eligible.map(x=>profile(x.receipt));
  if(profiles.some(p=>!p)||profiles.some(p=>canonicalize(p)!==canonicalize(profiles[0]))){
    report.history.status='incompatible';report.notices.push('History context is incompatible: missing provenance or contradictory model or judge identity. No historical findings.');return;
  }
  report.history.status='checked';
  for(let i=0;i<skill.suite.cases.length;i++) {
    const c=skill.suite.cases[i];
    if(eligible.some(x=>!complete(x.receipt,c))){report.notices.push(render(c.id)+': incomplete paired evidence, counts, threshold or rubric mismatch; history suppressed.');continue;}
    const rows=eligible.flatMap(x=>['with_skill','baseline'].map(mode=>{
      const row=x.receipt.results.cases.find(r=>r.id===c.id&&r.mode===mode);
      return {file:x.file,mode,outcome:row.outcome,score:row.score,threshold:row.threshold};
    }));
    const kind=rows.every(r=>r.outcome==='pass')?'ceiling':rows.every(r=>r.outcome==='fail')?'floor':null;if(!kind)continue;
    const drawCounts={with_skill:0,baseline:0};
    for(const x of eligible)for(const mode of Object.keys(drawCounts))drawCounts[mode]+=x.receipt.results.cases.find(r=>r.id===c.id&&r.mode===mode).generation.draws.length;
    report.cases[i].findings.push({kind,evidence:{receipts:eligible.map(x=>({file:x.file,hash:x.receipt.receipt_hash})),receiptCount:eligible.length,rows,drawCounts,model:profiles[0].model,judge:profiles[0].judge},
      why:'No pass/fail separation in these receipts; scores may differ; future runs may differ. Regrades are recorded observations. Receipt seals show integrity since sealing, not authenticity.'});
  }
}
function lintSuite(skillDir,{receiptsDir}={}) {
  try {
    const {skill,raw}=readSkill(path.resolve(skillDir));
    const receipts=receiptsDir===undefined?[]:readReceipts(path.resolve(receiptsDir));
    const tokens=reserve(skill,raw,receipts);
    const report={scope:SCOPE,cases:skill.suite.cases.map(c=>({id:c.id,findings:[]})),history:{status:'not-checked'},notices:[]};
    for(let i=0;i<tokens.length;i++)for(let j=i+1;j<tokens.length;j++){
      const run=longest(tokens[i],tokens[j]),den=Math.max(tokens[i].length,tokens[j].length),ratio=den?run.length/den:0;
      if(!run.length||!(run.length===tokens[i].length&&run.length===tokens[j].length||run.length>=5&&ratio>=.8))continue;
      const sharedWords=tokens[i].slice(run.a,run.a+run.length).map(x=>x.word);
      for(const [a,b]of [[i,j],[j,i]])report.cases[a].findings.push({kind:'near-duplicate',evidence:{otherCase:report.cases[b].id,sharedWords,wordCounts:[tokens[a].length,tokens[b].length],ratio},why:'These prompts repeat contiguous words and may repeat coverage. This is a lexical check.'});
    }
    for(let i=0;i<report.cases.length;i++){
      const c=skill.suite.cases[i];const expected=typeof raw[i].expected==='string'?raw[i].expected.trim():'';
      for(const f of fields(c)){const match=answerMatch(f.text,expected);if(match)report.cases[i].findings.push({kind:'answer-text',evidence:{field:f.field,...match},why:'This grading field contains supplied answer text or names a possible answer.'+(!raw[i].rubric&&expected&&c.rubric===expected?' The loader uses expected as its rubric fallback.':'')+' Model exposure was not checked.'});}
    }
    if(receiptsDir===undefined)report.notices.push('History not checked: receipts not supplied.');else addHistory(report,skill,receipts);
    if(report.cases.every(c=>!c.findings.length))report.notices.push('These checks found none.');
    bound('LINT_OUTPUT',Buffer.byteLength(render(report)));return report;
  } catch(e) {if(e.exitCode)throw e;fail('Input refused: '+e.message);}
}
module.exports={lintSuite,render,HELP,historyReason};
