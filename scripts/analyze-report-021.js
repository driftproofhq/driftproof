// SPDX-License-Identifier: Apache-2.0
'use strict';
// Offline Report 021 reader. No runner, provider client or private module is used.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { Transform, Writable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const ROOT = path.resolve(__dirname, '..');
const REPORT = path.join(ROOT, 'receipts/report-021');
const PAGE = path.join(ROOT, 'docs/reports/021/index.html');
const MODELS = ['claude-haiku-5-5', 'claude-sonnet-5-5'];
const ARMS = ['rule', 'baseline', 'village', 'generic'];
const FREEZE = '29cc4410236a062a95e65b2e993b5523d4405c0b412248cdb2fba97a906f572e';
const SELECTION = '6f2f2bd1327d1d4f7107cd454817757b4c44a718a53b01b5f858290820fb0ba9';
const need = (v, message) => { if (!v) throw new Error(message); };
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const cmp = (a,b) => a < b ? -1 : a > b ? 1 : 0;
const mean = values => values.length ? values.reduce((n,v) => n+v,0)/values.length : null;
const median = values => { const a=values.filter(Number.isFinite).sort((a,b)=>a-b);return a.length?(a[Math.floor((a.length-1)/2)]+a[Math.floor(a.length/2)])/2:null; };
function canonical(value) {
 if(value===null || typeof value!=='object')return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 return '{'+Object.keys(value).filter(k=>value[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
}
// Feed small canonical pieces into the hash instead of allocating another receipt-sized string.
function objectHash(value, omit) {
 const h=crypto.createHash('sha256');
 function visit(v,top=false) {
  if(v===null || typeof v!=='object'){h.update(JSON.stringify(v));return;}
  const array=Array.isArray(v),keys=array?Object.keys(v):Object.keys(v).filter(k=>v[k]!==undefined&&!(top&&k===omit)).sort();
  h.update(array?'[':'{');keys.forEach((k,i)=>{if(i)h.update(',');if(!array)h.update(JSON.stringify(k)+':');visit(v[k]);});h.update(array?']':'}');
 }
 visit(value,true);return h.digest('hex');
}
function assertComparable(a,b) { need(canonical(a)===canonical(b),'comparison conditions differ'); }
async function verifyReceiptFiles(dir, manifest, consume) {
 const entries=manifest.files;
 need(Array.isArray(entries)&&entries.length===12,'receipt inventory requires twelve files');
 need(entries.every(e=>/^[a-z0-9-]+\.json\.gz$/.test(e.file)),'unsafe receipt filename');
 const names=entries.map(e=>e.file);need(new Set(names).size===12,'duplicate receipt inventory');
 const actual=fs.readdirSync(dir).filter(f=>f!=='manifest.json');
 need(actual.length===12&&actual.every(f=>names.includes(f)),'missing or extra receipt inventory file');
 for(const e of entries) {
  const file=path.join(dir,e.file),stat=fs.lstatSync(file);
  need(stat.isFile()&&!stat.isSymbolicLink(),'unsafe receipt file');
  need(stat.size===e.gz_bytes,'compressed bytes mismatch: '+e.file);
  need(Number.isSafeInteger(e.json_bytes)&&e.json_bytes>0&&e.json_bytes<=256*1024*1024,'JSON size bound');
  const gzHash=crypto.createHash('sha256'),jsonHash=crypto.createHash('sha256'),chunks=[];let bytes=0;
  try { await pipeline(fs.createReadStream(file),new Transform({transform(chunk,encoding,cb){gzHash.update(chunk);cb(null,chunk);}}),
   zlib.createGunzip(),new Writable({write(chunk,encoding,cb){bytes+=chunk.length;if(bytes>e.json_bytes){cb(Error('JSON bytes bound exceeded'));return;}jsonHash.update(chunk);chunks.push(chunk);cb();}})); } catch(e) { throw Error('gzip integrity: '+e.message); }
  need(gzHash.digest('hex')===e.gz_sha256,'compressed SHA-256 mismatch: '+e.file);
  need(bytes===e.json_bytes,'JSON bytes mismatch: '+e.file);
  need(jsonHash.digest('hex')===e.json_sha256,'JSON SHA-256 mismatch: '+e.file);
  let json=Buffer.concat(chunks).toString('utf8');chunks.length=0;
  const receipt=JSON.parse(json);json=null;
  need(receipt.receipt_hash===e.receipt_hash&&objectHash(receipt,'receipt_hash')===e.receipt_hash,'receipt hash mismatch: '+e.file);
  await consume(receipt,e);
 }
}
let parser;
function getParser() {
 if(parser)return parser;
 try {need(require('@babel/parser/package.json').version==='7.29.14','parser version');need(hash(fs.readFileSync(require.resolve('@babel/parser')))==='21ccb0b91cdb0e0425379cb08f13296b710ac619d717b3b25652e18339ff8591','parser source identity');parser=require('@babel/parser');}
 catch {throw Error('Test counts require the pinned parser.\nnpm i --no-save @babel/parser@7.29.14');}
 return parser;
}
// Counter definition: count syntactic test/it sites, not executed cases. Unchanged starters are separate.
function countTests(snapshot, starter=[]) {
 const babel=getParser();
 if(!snapshot)return {total:null,starter:null,generated:null,unparsed_files:[]};
 let inherited=0,generated=0;const unparsed_files=[];
 function isSite(n) {
  while(n?.type==='MemberExpression'&&!n.computed&&!n.optional){if(!['each','only','skip'].includes(n.property?.name))return false;n=n.object;}
  return n?.type==='Identifier'&&['test','it'].includes(n.name);
 }
 for(const file of snapshot.entries.filter(f=>f.type==='file'&&/\.(test|spec)\.[cm]?[jt]sx?$/.test(f.path))) {
  const old=starter.some(s=>s.path===file.path&&s.sha256===file.sha256);let count=0;
  try {
   const source=Buffer.from(file.base64,'base64').toString('utf8');
   const stack=[babel.parse(source,{sourceType:'unambiguous',allowReturnOutsideFunction:true,plugins:['jsx','typescript'],errorRecovery:false})];
   while(stack.length){const n=stack.pop();if(!n||typeof n!=='object')continue;
    if(n.type==='CallExpression'&&isSite(n.callee))count++;
    if(n.type==='TaggedTemplateExpression'&&n.tag?.type==='MemberExpression'&&n.tag.property?.name==='each'&&isSite(n.tag))count++;
    for(const [k,v]of Object.entries(n)){if(['loc','start','end','comments','leadingComments','trailingComments','innerComments','extra','tokens'].includes(k))continue;if(Array.isArray(v))stack.push(...v);else if(v&&typeof v==='object')stack.push(v);}
   }
  }catch{unparsed_files.push({path:file.path,kind:old?'starter':'generated'});continue;}
  if(old)inherited+=count;else generated+=count;
 }
 return {total:unparsed_files.length?null:inherited+generated,starter:unparsed_files.some(f=>f.kind==='starter')?null:inherited,
  generated:unparsed_files.some(f=>f.kind==='generated')?null:generated,unparsed_files};
}
function scoreExecution(task, e) {
 if(e.status==='unmeasured'){need(e.pass_rate===null,'unmeasured rate');return {pass_rate:null,test_pass_rate:null,reason:e.reason};}
 need(e.status==='measured'&&Array.isArray(e.tests)&&e.tests.length>0&&e.tests.every(t=>['pass','fail'].includes(t.outcome)),'execution ledger');
 const passed=e.tests.filter(t=>t.outcome==='pass').length;
 need(e.passed===passed&&e.total===e.tests.length&&(e.pass_rate===undefined||e.pass_rate===passed/e.total),'execution counts or rate differ');
 if(e.tests.some(t=>t.reason==='test_timeout'))return {pass_rate:null,test_pass_rate:null,reason:'supervisor_timeout'};
 let tests=e.tests,existing=true;
 if(task.project){need(tests[0]?.name==='existing-regressions'&&canonical(tests.map(t=>t.name))===canonical(task.test_names),'execution project check ledger');existing=tests[0].outcome==='pass';tests=tests.slice(1);}
 need(tests.length>0,'execution checks absent');
 const fraction=tests.filter(t=>t.outcome==='pass').length/tests.length,base={pass_rate:Number(existing&&fraction===1),test_pass_rate:fraction};
 if(task.topic!=='jest')return base;
 need(tests[0]?.name==='reference-pass'&&tests.length===task.jest_modules.length,'execution mutant ledger');
 const reference_pass=tests[0].outcome==='pass',caught=reference_pass?tests.slice(1).filter(t=>t.outcome==='pass').length:0;
 return {...base,reference_pass,caught,total:tests.length-1,mutant_pass_rate:caught/(tests.length-1)};
}
function summarizeRows(rows) {
 for(const r of rows){need(new Set(r.draws.map(d=>d.index)).size===r.draws.length,'duplicate draw index');need(r.draws.length<=r.planned,'draw count exceeds planned');}
 const ds=rows.flatMap(r=>r.draws),seen=ds.filter(d=>d.observed),planned=rows.reduce((n,r)=>n+r.planned,0);
 const all_caught=seen.reduce((n,d)=>n+d.all,0),caught=seen.reduce((n,d)=>n+d.caught,0),total=seen.reduce((n,d)=>n+d.total,0);
 const lost=ds.filter(d=>d.attempted&&!d.observed).length,share=seen.length?all_caught/seen.length:null;
 const counts=ds.map(d=>d.tests).filter(Number.isFinite),generated=ds.map(d=>d.test_counts?.generated).filter(Number.isFinite),starter=ds.map(d=>d.test_counts?.starter).filter(Number.isFinite);
 return {planned,attempted:seen.length+lost,observed:seen.length,lost,missing:planned-seen.length-lost,all_caught,all_caught_share:share,pooled_all_caught_share:share,
  task_mean_all_caught_share:mean(rows.map(r=>mean(r.draws.filter(d=>d.observed).map(d=>d.all))).filter(v=>v!==null)),caught,total,pooled_bug_share:total?caught/total:null,
  task_mean_bug_share:mean(rows.map(r=>mean(r.draws.filter(d=>d.observed).map(d=>d.caught/d.total))).filter(v=>v!==null)),
  median_tests:median(counts),test_count_draws:counts.length,median_generated_tests:median(generated),generated_test_count_draws:generated.length,
  median_starter_tests:median(starter),starter_test_count_draws:starter.length,
  test_count_unparsed:rows.flatMap(r=>r.draws.flatMap(d=>(d.test_counts?.unparsed_files||[]).map(f=>({task:r.id,index:d.index,...f})))),
  losses:rows.flatMap(r=>r.draws.filter(d=>!d.observed).map(d=>({task:r.id,index:d.index,reason:d.reason})))};
}
function bootstrap(items,statistic) {
 if(!items.length)return null;let seed=501;const samples=[];
 for(let k=0;k<4000;k++){const sample=[];for(let i=0;i<items.length;i++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;sample.push(items[Math.floor((seed>>>0)/4294967296*items.length)]);}samples.push(statistic(sample));}
 samples.sort((a,b)=>a-b);return [samples[100],samples[3900]];
}
function contrastRows(left,right) {
 need(new Set(left.map(r=>r.id)).size===left.length&&new Set(right.map(r=>r.id)).size===right.length,'duplicate task');
 const pairs=left.map(l=>[l,right.find(r=>r.id===l.id)]).filter(([l,r])=>r&&l.draws.some(d=>d.observed)&&r.draws.some(d=>d.observed)).sort((a,b)=>cmp(a[0].id,b[0].id));
 const values=pairs.map(([l,r])=>[summarizeRows([l]),summarizeRows([r])]);
 const all=values.map(([l,r])=>l.all_caught_share-r.all_caught_share),task=values.map(([l,r])=>l.task_mean_bug_share-r.task_mean_bug_share);
 const ratio=ps=>{const sum=side=>ps.reduce((v,p)=>[v[0]+p[side].caught,v[1]+p[side].total],[0,0]),a=sum(0),b=sum(1);return a[0]/a[1]-b[0]/b[1];};
 return {tasks:pairs.length,paired_tasks:pairs.map(p=>p[0].id),excluded_tasks:[...new Set([...left,...right].map(r=>r.id))].filter(id=>!pairs.some(p=>p[0].id===id)).sort(),
  all_caught:{basis:'equal-weight paired task means',left_task_mean_share:mean(values.map(([l])=>l.all_caught_share)),right_task_mean_share:mean(values.map(([,r])=>r.all_caught_share)),delta:mean(all),ci:bootstrap(all,mean)},
  bug_share:{delta:values.length?ratio(values):null,ci:bootstrap(values,ratio)},
  task_mean_bug_share:{left_task_mean_share:mean(values.map(([l])=>l.task_mean_bug_share)),right_task_mean_share:mean(values.map(([,r])=>r.task_mean_bug_share)),delta:mean(task),ci:bootstrap(task,mean)}};
}
function replaceDraws(rows,replacements,identity) {
 const primary=structuredClone(rows),sensitivity=structuredClone(rows),used=new Set();let harness_lost=0;
 for(const r of rows)for(const d of r.draws)if(d.attempted&&!d.observed)harness_lost++;
 for(const replacement of replacements){const s=replacement.source,key=canonical(s);need(!used.has(key),'duplicate replacement');used.add(key);
  need(s.receipt_hash===identity.receipt_hash&&s.model===identity.model,'replacement source identity');
  const row=primary.find(r=>r.id===s.task&&r.arm===s.arm),target=row?.draws.find(d=>d.index===s.index);
  need(target&&target.attempted&&!target.observed,'replacement source is missing or observed');
  need(replacement.draw.attempted&&replacement.draw.observed,'replacement not observed');
  row.draws[row.draws.indexOf(target)]={...structuredClone(replacement.draw),index:target.index};
 }
 for(const r of sensitivity)for(const d of r.draws)if(d.attempted&&!d.observed)Object.assign(d,{observed:true,all:0,caught:0,total:r.bug_count,imputed_harness_loss:true});
 return {primary,sensitivity,harness_lost,replaced:replacements.length,original_observed:rows.flatMap(r=>r.draws).filter(d=>d.observed).length,imputed_losses:harness_lost};
}
function checkAnalysis(actual,expected,label='analysis') {
 if(typeof actual==='number'&&typeof expected==='number'){
  // Reference reductions can add the same fractions in different task order.
  need(actual===expected||Math.abs(actual-expected)<=Number.EPSILON*16*Math.max(1,Math.abs(expected)),label+' numeric mismatch');return;
 }
 if(actual===null||expected===null||typeof actual!=='object'||typeof expected!=='object'){need(actual===expected,label+' mismatch');return;}
 need(canonical(Object.keys(actual).sort())===canonical(Object.keys(expected).sort()),label+' fields differ');
 for(const k of Object.keys(expected))checkAnalysis(actual[k],expected[k],label+'.'+k);
}
const RULE_FILES={ 'opaque-1':'copilot-security-and-owasp.md','opaque-2':'windsurf-honey.md','opaque-3':'cursor-jest-unit-testing.md','opaque-4':'cursor-python-fastapi.md' };
function validateSelection(selection, cases) {
 need(selection.selection_hash===SELECTION&&objectHash(selection,'selection_hash')===SELECTION,'selection hash differs');
 need(cases.length===68&&new Set(cases.map(c=>c.id)).size===68,'frozen pool count');
 for(const group of selection.topics){
  for(const r of group.rankings){const observations=selection.observations.filter(o=>o.id===r.id&&o.status==='measured');
   const passed=observations.filter(o=>o.all_pass).length;
   need(observations.length===r.measured&&passed===r.passed&&r.share===passed/observations.length&&r.distance===Math.abs(2*passed-observations.length)/(2*observations.length),'calibration selection counts differ');
   need(cases.some(c=>c.id===r.id&&c.topic===group.topic&&c.pool_order===r.pool_order),'selection task identity');
  }
  const selected=group.rankings.filter(r=>r.eligible).sort((a,b)=>a.distance-b.distance||a.pool_order-b.pool_order).slice(0,12).map(r=>r.id).sort();
  const declared=group.selected||group.selected_ids;
  need(Array.isArray(declared)&&canonical(selected)===canonical([...declared].sort()),'selected task set differs');
 }
}
function reduceReceipt(r,entry,folder) {
 need(['quality-receipt/1','quality-ablation/1','quality-replacement/1'].includes(r.schema),'unsupported receipt schema '+r.schema);
 need(r.evidence_kind==='observed'&&MODELS.includes(r.conditions.model),'observed model identity');
 need(r.conditions.freeze===FREEZE&&r.freeze.freeze_hash===FREEZE&&objectHash(r.freeze,'freeze_hash')===FREEZE,'suite freeze identity');
 need(r.conditions.project.selection_hash===SELECTION,'selection condition identity');
 need(r.conditions.plan_hash===r.plan.plan_hash&&objectHash(r.plan,'plan_hash')===r.plan.plan_hash,'plan seal');
 const phase=r.conditions.phase,topic=r.freeze.cases.find(c=>c.id===r.conditions.tasks[0]).topic;
 const suite=read(path.join(folder,'suite/project-'+topic+'.json'));
 for(const t of r.freeze.cases.filter(c=>c.topic===topic))need(suite.cases.some(c=>c.id===t.id&&c.project_hash===t.project_hash),'public suite project identity');
 need(r.conditions.tasks.length===12&&new Set(r.conditions.tasks).size===12,'selected task count');
 if(phase==='full')validateSelection(r.plan.selection.selection,r.freeze.cases);
 need(hash(r.subject.text)===r.subject.sha256&&fs.readFileSync(path.join(folder,'rules',RULE_FILES[r.subject.slot]),'utf8')===r.subject.text,'rules text identity');
 if(r.subject.generic_text)need(hash(r.subject.generic_text)===r.subject.generic_sha256,'generic text identity');
 if(phase==='ablation')need(fs.readFileSync(path.join(folder,'rules/cursor-jest-unit-testing-minus-line.md'),'utf8')===r.plan.derived.text&&hash(r.plan.derived.text)===r.plan.derived.sha256,'removal text identity');
 const expectedArms=phase==='full'?ARMS:['rule-minus-line','rule','baseline'];
 if(phase!=='replacement')need(r.rows.length===12*expectedArms.length&&r.conditions.tasks.every(id=>expectedArms.every(arm=>r.rows.filter(row=>row.id===id&&row.arm===arm).length===1)),'task/arm inventory differs');
 const rows=r.rows.map(row=>{
  const task=r.freeze.cases.find(c=>c.id===row.id);need(task&&r.conditions.tasks.includes(row.id),'row task identity');
  need(new Set(row.draws.map(d=>d.index)).size===row.draws.length,'duplicate draw index');
  const indices=phase==='replacement'?row.draws.map(d=>d.index):Array.from({length:r.conditions.draws},(_,i)=>i);
  need(row.draws.every(d=>indices.includes(d.index)),'unscheduled draw index');
  const draws=indices.map(index=>{
   const d=row.draws.find(x=>x.index===index),calls=r.calls.filter(c=>c.task===row.id&&c.arm===row.arm&&c.index===index&&c.kind==='generation');
   need(calls.length<=1,'duplicate generation event');const attempted=calls.length===1;
   let score=null;
   if(d?.status==='measured'&&d.execution){
    need(attempted,'observation without generation event');
    need(d.execution.freeze_hash===FREEZE&&d.execution.runtime_image_digest===r.conditions.runtime_image&&d.execution.effective_environment_hash===r.conditions.effective_environment,'execution conditions differ');
    need(d.execution.snapshot_hash===d.snapshot?.snapshot_hash,'execution snapshot binding');
    need(objectHash(d.execution,'execution_hash')===d.execution.execution_hash,'execution seal');
    need(d.execution.test_names_hash===objectHash(task.test_names),'execution check identity');
    score=scoreExecution(task,d.execution);
   }
   const observed=!!score&&score.pass_rate!==null;
   const counts=topic==='jest'?countTests(d?.snapshot,d?.generation?.starter_manifest||[]):null;
   if(counts)need(counts.unparsed_files.length===0,'unparsed test files prevent complete median');
   return {index,attempted,observed,reason:observed?null:d?.reason||(attempted?'terminal draw evidence lost':'not attempted'),
    all:observed?score.pass_rate:null,secondary:observed?score.test_pass_rate:null,
    caught:observed?score.caught:null,total:observed?score.total:null,tests:counts?.total??null,test_counts:counts,
    ...(d?.source?{source:d.source}:{})};
  });
  return {id:row.id,arm:row.arm,planned:phase==='replacement'?draws.length:r.conditions.draws,bug_count:task.mutant_count,draws};
 });
 const out={file:entry.file,receipt_hash:r.receipt_hash,model:r.conditions.model,phase,topic,subject:r.subject.slot,conditions:r.conditions,rows};
 if(phase==='replacement')out.jobs=r.plan.jobs;
 return out;
}
function mainContrast(rows,metric) {
 const ids=[...new Set(rows.map(r=>r.id))].sort(),values=Object.fromEntries(ids.map(id=>[id,Object.fromEntries(ARMS.map(a=>{
  const row=rows.find(r=>r.id===id&&r.arm===a);need(row,'missing task arm');return [a,mean(row.draws.filter(d=>d.observed).map(d=>metric==='secondary'?d.secondary:d.all))];
 }))]));
 const out={losses:ids.map(id=>({id,...Object.fromEntries(ARMS.map(a=>{const r=rows.find(r=>r.id===id&&r.arm===a),n=r.draws.filter(d=>d.observed).length;return[a,{observed:n,missing:r.planned-n}];}))}))};
 for(const [name,l,r]of [['baseline','rule','baseline'],['village','rule','village'],['generic','rule','generic'],['generic_baseline','generic','baseline']]){
  const included=ids.filter(id=>values[id][l]!==null&&values[id][r]!==null),diffs=included.map(id=>values[id][l]-values[id][r]),ci=bootstrap(diffs,mean);
  out[name]={n:included.length,delta:mean(diffs),ci,better:!!ci&&ci[0]>0,excluded:ids.filter(id=>!included.includes(id)).map(id=>({id,reason:'no observed draws in '+[l,r].filter(a=>values[id][a]===null).join(', ')}))};
 }
 return out;
}
const ARM_NAMES={ablation:{'rule-minus-line':'rule-minus-line',rule:'same-day rule',baseline:'same-day baseline'},full:{rule:'original rule',baseline:'original baseline',village:'original village',generic:'original generic'}};
const CONTRASTS=[['rule-minus-line','same-day rule'],['rule-minus-line','same-day baseline'],['same-day rule','original rule'],['same-day baseline','original baseline']];
function compute(sources) {
 const main=sources.filter(s=>s.phase==='full');need(main.length===8,'eight main receipts required');
 const output={main:[],removal:{},replacement:{},totals:{planned:0,observed:0,lost:0,replaced:0}};
 for(const s of main){
  const arms=Object.fromEntries(ARMS.map(a=>{const rows=s.rows.filter(r=>r.arm===a),ds=rows.flatMap(r=>r.draws),observed=ds.filter(d=>d.observed);
   return [a,{planned:rows.reduce((n,r)=>n+r.planned,0),attempted:ds.filter(d=>d.attempted).length,observed:observed.length,lost:ds.filter(d=>d.attempted&&!d.observed).length,
    all:observed.reduce((n,d)=>n+d.all,0),share:mean(observed.map(d=>d.all)),secondary:mean(observed.map(d=>d.secondary))}];}));
  const ids=[...new Set(s.rows.map(r=>r.id))],same=ids.filter(id=>{const means=ARMS.map(a=>mean(s.rows.find(r=>r.id===id&&r.arm===a).draws.filter(d=>d.observed).map(d=>d.all)));return means.every(v=>v===means[0]);});
  need(same.every(id=>[0,1].includes(mean(s.rows.find(r=>r.id===id&&r.arm==='rule').draws.filter(d=>d.observed).map(d=>d.all)))),'same-arm task is not at ceiling or floor');
  output.main.push({model:s.model,subject:s.subject,topic:s.topic,arms,same:same.length,overall:mainContrast(s.rows,'all'),secondary:mainContrast(s.rows,'secondary'),rows:s.rows});
 }
 for(const model of MODELS){
  const old=sources.find(s=>s.model===model&&s.phase==='full'&&s.topic==='jest'),fresh=sources.find(s=>s.model===model&&s.phase==='ablation'),rerun=sources.find(s=>s.model===model&&s.phase==='replacement');
  need(old&&fresh&&rerun,'missing Jest phase');
  for(const s of [fresh,rerun]){const omit=c=>{const {phase,plan_hash,...held}=c;return held;};assertComparable(omit(old.conditions),omit(s.conditions));}
  const rawRows={},primaryRows={},sensitivityRows={},rawArms={},primaryArms={},sensitivityArms={};
  for(const source of [old,fresh])for(const [arm,name]of Object.entries(ARM_NAMES[source.phase])){
   const rows=source.rows.filter(r=>r.arm===arm),sorted=[...rows].sort((a,b)=>cmp(a.id,b.id));
   const replacements=rerun.rows.filter(r=>r.arm===arm).flatMap(r=>r.draws.filter(d=>d.source?.receipt_hash===source.receipt_hash).map(d=>{
    need(rerun.jobs.some(j=>j.model===model&&j.task===r.id&&j.arm===r.arm&&j.index===d.index&&canonical(j.source)===canonical(d.source)),'replacement job identity differs');
    return {source:{...d.source,model},draw:d};
   }));
   const swapped=replaceDraws(sorted,replacements,{receipt_hash:source.receipt_hash,model});
   rawRows[name]=rows;primaryRows[name]=swapped.primary;sensitivityRows[name]=swapped.sensitivity;
   rawArms[name]=summarizeRows(rows);
   for(const [kind,rs,dest]of [['primary',swapped.primary,primaryArms],['sensitivity',swapped.sensitivity,sensitivityArms]]){
    const a=summarizeRows(rs),base=summarizeRows(sorted);a.scored_draws=a.observed;
    Object.assign(a,{harness_lost:swapped.harness_lost,replaced:kind==='primary'?swapped.replaced:0,still_lost:kind==='primary'?swapped.harness_lost-swapped.replaced:swapped.harness_lost,imputed_losses:kind==='primary'?0:swapped.harness_lost});
    if(kind==='sensitivity')for(const k of ['observed','attempted','lost','missing','losses'])a[k]=base[k];dest[name]=a;
   }
   output.totals.replaced+=replacements.length;
  }
  const contrasts=rows=>Object.fromEntries(CONTRASTS.map(([l,r])=>[l+' vs '+r,contrastRows(rows[l],rows[r])]));
  output.removal[model]={arms:rawArms,contrasts:contrasts(rawRows)};
  output.replacement[model]={primary:{arms:primaryArms,contrasts:contrasts(primaryRows)},sensitivity:{arms:sensitivityArms,contrasts:contrasts(sensitivityRows)}};
 }
 for(const s of sources.filter(s=>s.phase!=='replacement'))for(const row of s.rows){output.totals.planned+=row.planned;output.totals.observed+=row.draws.filter(d=>d.observed).length;output.totals.lost+=row.draws.filter(d=>d.attempted&&!d.observed).length;}
 return output;
}
function compareOutputs(data,folder) {
 const main=read(path.join(folder,'analysis/main-analysis.json'));
 for(const result of data.main){const expected=main.results.find(r=>r.model===result.model&&r.subject===result.subject);need(expected,'main analysis cell missing');
  checkAnalysis(result.overall,expected.overall,'main overall');checkAnalysis(result.secondary,expected.secondary.overall,'main secondary');
  for(const row of result.rows){const want=expected.ledger.find(r=>r.id===row.id&&r.arm===row.arm);need(want,'analysis ledger row missing');
   checkAnalysis(row.draws.map(d=>d.all),want.values,'main ledger values');checkAnalysis(row.draws.map(d=>d.secondary),want.test_values,'main ledger secondary');
   const observed=row.draws.filter(d=>d.observed).length,lost=row.draws.filter(d=>d.attempted&&!d.observed).length;
   checkAnalysis({planned:row.planned,attempted:observed+lost,observed,lost,missing:row.planned-observed-lost},Object.fromEntries(['planned','attempted','observed','lost','missing'].map(k=>[k,want[k]])),'main accounting');
  }
 }
 const removal=read(path.join(folder,'analysis/removal-analysis.json')),replacement=read(path.join(folder,'analysis/removal-with-reruns-analysis.json'));
 for(const model of MODELS){
  checkAnalysis(data.removal[model].arms,removal.models[model].arms,'removal arms');
  checkAnalysis(data.removal[model].contrasts,removal.models[model].contrasts,'removal contrasts');
  checkAnalysis(data.replacement[model],replacement.models[model],'replacement primary and sensitivity');
 }
}
// Visible text of the generated page: one linear scan (comments, script and style bodies and tags
// dropped), then entities decoded in a single pass, so no decoded character is decoded again.
const ENTITIES={amp:'&',lt:'<',gt:'>',quot:'"','#39':"'",nbsp:' '};
function htmlText(html){
 let out='',i=0;const low=html.toLowerCase();
 while(i<html.length){
  if(html[i]!=='<'){out+=html[i++];continue;}
  if(low.startsWith('<!--',i)){const e=low.indexOf('-->',i+4);i=e<0?html.length:e+3;continue;}
  const raw=/^<(script|style)\b/.exec(low.slice(i,i+8));
  if(raw){const e=low.indexOf('</'+raw[1],i);if(e<0){i=html.length;continue;}const g=low.indexOf('>',e);i=g<0?html.length:g+1;continue;}
  const g=html.indexOf('>',i);if(g<0){out+=html.slice(i);break;}i=g+1;
 }
 return out.replace(/&(amp|lt|gt|quot|#39|nbsp);/g,(_,n)=>ENTITIES[n]).replace(/\s+/g,' ').trim();
}
function checkPageNumbers(html, expected) {
 let remainder=html;
 for(const e of expected){const re=new RegExp('<([a-z][a-z0-9]*)[^>]*data-report-number="'+e.id+'"[^>]*>([^]*?)<\\/\\1>','g'),matches=[...html.matchAll(re)];
  need(matches.length===1&&htmlText(matches[0][2])===e.display,'page number mismatch: '+e.id);remainder=remainder.replace(re,'');}
 need(!/\d/.test(htmlText(remainder)),'page unbound numerical claim');
}
function checkVerdicts(html,bindings) {
 for(const b of bindings){const match=new RegExp('<([a-z][a-z0-9]*)[^>]*data-report-verdict="'+b.id+'"[^>]*>([^]*?)<\\/\\1>').exec(html);
  need(match&&htmlText(match[2]).includes(b.word),'verdict word missing: '+b.id);
  const includes=ci=>ci&&ci[0]<=0&&ci[1]>=0;
  const valid=b.word==='clear'?b.ranges.every(ci=>ci&&(ci[0]>0||ci[1]<0)):
   ['not shown','includes zero'].includes(b.word)?b.ranges.every(includes):b.ranges.every(ci=>ci&&ci[0]<=0);
  need(valid,'verdict word contradicts computed range: '+b.id);
 }
}
function checkClaimWording(html) {
 const text=htmlText(html);need(!/\bpopular\b|\bsubscription\b/i.test(text),'page claim: popular or subscription wording');
 // The full report is checked word for word against its approved template below.
 // For individual result sentences, a numeric result needs a measure in the sentence.
 if(!/<h1\b/i.test(html))for(const sentence of text.split(/(?<=[.!?])\s+/))if(/\d+(?:\.\d+)?%|\d+(?:\.\d+)? points/.test(sentence))
  need(/share|tests written|attempts|bugs caught|hidden tests|measure/i.test(sentence),'page claim has no named measure');
}
function checkZenodo(html,manifest) {
 const ids=[...html.matchAll(/(?:zenodo\.|zenodo\.org\/records\/)(__ZENODO_RECORD__|\d+)/g)].map(m=>m[1]);
 for(const e of manifest.files){const m=/^https:\/\/zenodo\.org\/records\/(__ZENODO_RECORD__|\d+)\/files\/([^?]+)\?download=1$/.exec(e.url);need(m&&m[2]===e.file,'Zenodo URL filename');ids.push(m[1]);}
 need(ids.length>=manifest.files.length+1&&new Set(ids).size===1,'Zenodo record ids must be consistent');return ids[0];
}
function writeSums(folder) {
 const files=fs.readdirSync(folder,{recursive:true}).filter(f=>f!=='SHA256SUMS'&&fs.statSync(path.join(folder,f)).isFile()).sort();
 fs.writeFileSync(path.join(folder,'SHA256SUMS'),files.map(f=>hash(fs.readFileSync(path.join(folder,f)))+'  '+f).join('\n')+'\n');
}
function verifySupport(folder) {
 const expected=fs.readdirSync(folder,{recursive:true}).filter(f=>f!=='SHA256SUMS'&&fs.statSync(path.join(folder,f)).isFile()).sort();
 need(expected.every(f=>!f.endsWith('.gz')&&!/\.(?:js|cjs|mjs)$/.test(f)),'unexpected receipt or code in public support data');
 const entries=fs.readFileSync(path.join(folder,'SHA256SUMS'),'utf8').trim().split('\n').map(line=>{const m=/^([a-f0-9]{64})  ([a-zA-Z0-9/_.-]+)$/.exec(line);need(m&&!m[2].split('/').includes('..'),'invalid checksum entry');return {sha:m[1],file:m[2]};});
 need(canonical(entries.map(e=>e.file).sort())===canonical(expected),'support checksum inventory differs');
 for(const e of entries)need(hash(fs.readFileSync(path.join(folder,e.file)))===e.sha,'support hash mismatch: '+e.file);
 const manifest=read(path.join(folder,'manifest.json'));
 for(const [file,sha]of Object.entries(manifest.support||{}))need(entries.some(e=>e.file===file&&e.sha===sha),'manifest support hash mismatch: '+file);
}
function setZenodoRecord(id,root=ROOT) {
 need(typeof id==='string'&&/^\d+$/.test(id),'Zenodo record must contain only digits');
 const folder=path.join(root,'receipts/report-021'),page=path.join(root,'docs/reports/021/index.html');
 const manifest=read(path.join(folder,'manifest.json')),html=fs.readFileSync(page,'utf8');
 const current=checkZenodo(html,manifest);need(current==='__ZENODO_RECORD__'||current===id,'Zenodo record is already filled with a different id');
 const before=manifest.files.map(({url,...entry})=>entry);
 const next=html.replaceAll('__ZENODO_RECORD__',id),m=JSON.parse(JSON.stringify(manifest).replaceAll('__ZENODO_RECORD__',id));
 checkAnalysis(m.files.map(({url,...entry})=>entry),before,'content hashes');checkZenodo(next,m);
 fs.writeFileSync(page,next);fs.writeFileSync(path.join(folder,'manifest.json'),JSON.stringify(m,null,2)+'\n');
 writeSums(folder);console.log('report 021 Zenodo: record '+id+'; content hashes unchanged');
}
// Only for an early refusal and rendering the approved page. Successful --check always
// independently derives observations from all verified receipts and compares them below.
function archivedData(folder=REPORT) {
 const original=read(path.join(folder,'analysis/main-analysis.json')),
  removal=read(path.join(folder,'analysis/removal-analysis.json')),
  replacement=read(path.join(folder,'analysis/removal-with-reruns-analysis.json'));
 const main=original.results.map(r=>{
  const rows=r.ledger.map(x=>({id:x.id,arm:x.arm,planned:x.planned,draws:x.values.map((v,i)=>({all:v,secondary:x.test_values[i],observed:v!==null}))}));
  const arms=Object.fromEntries(ARMS.map(a=>{const ledger=r.ledger.filter(x=>x.arm===a),ds=rows.filter(x=>x.arm===a).flatMap(x=>x.draws).filter(d=>d.observed);return[a,{planned:ledger.reduce((n,x)=>n+x.planned,0),observed:ds.length,lost:ledger.reduce((n,x)=>n+x.lost,0),all:ds.reduce((n,d)=>n+d.all,0),share:mean(ds.map(d=>d.all)),secondary:mean(ds.map(d=>d.secondary))}];}));
  const same=[...new Set(rows.map(x=>x.id))].filter(id=>{const shares=ARMS.map(a=>mean(rows.find(x=>x.id===id&&x.arm===a).draws.filter(d=>d.observed).map(d=>d.all)));return shares.every(v=>v===shares[0]);}).length;
  return {model:r.model,subject:r.subject,topic:Object.keys(r.topics)[0],arms,same,overall:r.overall,secondary:r.secondary.overall};
 });
 const totals={planned:0,lost:0,replaced:replacement.replacement_attempts.length};
 for(const r of main)for(const a of Object.values(r.arms)){totals.planned+=a.planned;totals.lost+=a.lost;}
 for(const m of MODELS)for(const [name,a]of Object.entries(removal.models[m].arms))if(!name.startsWith('original')){totals.planned+=a.planned;totals.lost+=a.lost;}
 return {main,removal:removal.models,replacement:replacement.models,totals};
}
function pageValues(data) {
 const values={};const pct=x=>(100*x).toFixed(1),pt=x=>(100*x).toFixed(1),signed=x=>(x<0?'−':x>0?'+':'')+Math.abs(100*x).toFixed(1);
 for(const [short,model]of [['h',MODELS[0]],['s',MODELS[1]]]){
  const view=data.replacement[model].primary;
  for(const [key,name]of [['ob','original baseline'],['or','original rule'],['rm','rule-minus-line'],['sr','same-day rule'],['sb','same-day baseline']]){
   const a=view.arms[name],prefix=`j.${short}.${key}`;
   values[prefix+'.all']=pct(a.all_caught_share)+'%';values[prefix+'.alln']=pct(a.all_caught_share)+'% ('+a.all_caught+')';
   values[prefix+'.bug']=pct(a.pooled_bug_share)+'%';values[prefix+'.median']=String(a.median_generated_tests);
  }
  values['j.'+short+'.drop']=pt(view.arms['original baseline'].pooled_bug_share-view.arms['original rule'].pooled_bug_share);
  for(const [key,name]of [['remove','rule-minus-line vs same-day rule'],['base','rule-minus-line vs same-day baseline'],['drift','same-day rule vs original rule']])
   for(const [metric,field]of [['all','all_caught'],['bug','bug_share']]){
    const c=view.contrasts[name][field],p=`c.${short}.${key}.${metric}`;
    values[p+'.delta']=pt(c.delta);values[p+'.signed']=signed(c.delta);values[p+'.lo']=pt(c.ci[0]);values[p+'.hi']=pt(c.ci[1]);
    values[p+'.slo']=signed(c.ci[0]);values[p+'.shi']=signed(c.ci[1]);
   }
 }
 for(const r of data.main){const m=r.model===MODELS[0]?'h':'s',p=`o.${r.topic}.${m}`,c=r.overall.baseline;
  values[p+'.base']=(r.arms.baseline.share*100).toFixed(1)+'%';values[p+'.rule']=(r.arms.rule.share*100).toFixed(1)+'%';
  values[p+'.change']=signed(c.delta)+' ('+signed(c.ci[0])+' to '+signed(c.ci[1])+')';values[p+'.same']=String(r.same);
  for(const [key,contrast]of [['rule',r.secondary.baseline],['generic',r.secondary.generic_baseline]]){
   values[p+'.'+key+'.secondary']=signed(contrast.delta);
   values[p+'.'+key+'.range']='+'+(contrast.ci[0]*100).toFixed(2)+' to '+signed(contrast.ci[1]);
  }
 }
 values['totals.lost']=String(data.totals.lost);values['totals.planned']=data.totals.planned.toLocaleString('en-US');
 values['totals.replaced']=String(data.totals.replaced);values['totals.unreplaced']=String(data.totals.lost-data.totals.replaced);
 return values;
}
function reportVerdicts(html,data) {
 const ranges=[];
 for(const model of MODELS){const original=data.main.find(r=>r.topic==='jest'&&r.model===model);need(original.overall.baseline.ci[1]<0&&original.secondary.baseline.ci[1]<0,'original Jest decline verdict contradicts range');
  const contrasts=data.replacement[model].primary.contrasts,remove=contrasts['rule-minus-line vs same-day rule'];
  need(remove.all_caught.ci[0]>0,'removing line all-bug verdict contradicts range');
  if(model===MODELS[1])need(remove.bug_share.ci[0]>0,'Sonnet clear verdict contradicts range');
  else need(remove.bug_share.ci[0]<=0&&remove.bug_share.ci[1]>=0,'Haiku not shown verdict contradicts range');
  for(const metric of ['all_caught','bug_share']){const c=contrasts['rule-minus-line vs same-day baseline'][metric];need(c.ci[0]<=0&&c.ci[1]>=0,'includes zero verdict contradicts range');}
 }
 for(const r of data.main.filter(r=>r.topic!=='jest'))ranges.push(r.overall.baseline.ci);
 need(ranges.every(c=>c[0]<=0),'no-help verdict contradicts range');
 need(/Haiku, share of planted bugs caught: not shown/.test(htmlText(html)),'Haiku not shown word missing');
 need(/Sonnet, both measures: clear/.test(htmlText(html))&&/Haiku, share of attempts that caught every bug: clear/.test(htmlText(html)),'clear words missing');
}

// Approved report words. Only named computed values and the evidence section vary.
const BODY_TEMPLATE =
"\n" +
"<h1>One line in a Jest rules file made Claude's tests miss bugs</h1>\n" +
"<p class=\"report-type\">Rules-file quality report</p>\n" +
"\n" +
"<p class=\"lede\">We gave Claude a Jest rules file from the awesome-cursorrules list and asked it to write tests for 12 small projects with bugs planted in them. With the file, Sonnet's tests caught every planted bug in <strong>{{j.s.or.all}}</strong> of attempts against <strong>{{j.s.ob.all}}</strong> with no file (share of attempts that caught every bug), and caught {{j.s.drop}} points fewer of the planted bugs, <strong>{{j.s.or.bug}}</strong> against <strong>{{j.s.ob.bug}}</strong> (share of planted bugs caught). One line in the file asks for 3 to 5 tests per file. When we removed just that line and ran again, the drop went away for Sonnet on both measures, and for Haiku on the share of attempts that caught every bug.</p>\n" +
"\n" +
"<div class=\"wrap\"><table>\n" +
"<thead><tr><th>Jest tasks, 120 attempts per cell</th><th>Sonnet, no file</th><th>Sonnet, with file</th><th>Haiku, no file</th><th>Haiku, with file</th></tr></thead>\n" +
"<tbody>\n" +
"<tr><td>Share of attempts that caught every bug</td><td>{{j.s.ob.alln}}</td><td>{{j.s.or.alln}}</td><td>{{j.h.ob.alln}}</td><td>{{j.h.or.alln}}</td></tr>\n" +
"<tr><td>Share of planted bugs caught</td><td>{{j.s.ob.bug}}</td><td>{{j.s.or.bug}}</td><td>{{j.h.ob.bug}}</td><td>{{j.h.or.bug}}</td></tr>\n" +
"<tr><td>Tests written per attempt (median)</td><td>{{j.s.ob.median}}</td><td>{{j.s.or.median}}</td><td>{{j.h.ob.median}}</td><td>{{j.h.or.median}}</td></tr>\n" +
"</tbody>\n" +
"<caption>Each task plants 20 bugs, so 120 attempts face 2,400 planted bugs. A bug counts as caught when the model's tests pass on the correct code and fail on the bugged copy. Haiku figures include 5 attempts re-run after the test setup lost them (see Limits). <a href=\"https://github.com/driftproofhq/driftproof/blob/main/scripts/analyze-report-021.js#LCOUNTER_LINE\">Tests written</a>: <code>test()</code> and <code>it()</code> calls (with their <code>.each</code>, <code>.only</code> and <code>.skip</code> forms) in the test files the model added, counted in its finished project; a call inside a loop or a <code>test.each</code> table counts once. Every starter project already had 19 tests, which no attempt changed and which are not counted.</caption>\n" +
"</table></div>\n" +
"\n" +
"<p>The two measures tell one story at different scales. Most single bugs are still caught with the file (the share of planted bugs caught falls by {{j.s.drop}} points for Sonnet and {{j.h.drop}} for Haiku). But a test file with fewer tests almost always misses at least one, so the share of attempts that caught every bug collapses.</p>\n" +
"\n" +
"<div class=\"box\">\n" +
"<h2>Limits</h2>\n" +
"<ul>\n" +
"<li><strong>Single-turn tasks.</strong> One prompt per attempt, in a small starter project. There was no back-and-forth with a person.</li>\n" +
"<li><strong>Not run inside Cursor, Copilot or Windsurf.</strong> Each rules file was given to the model as always-on text. The editors decide for themselves when to attach a rule, and they add their own instructions; we reproduce neither.</li>\n" +
"<li><strong>Two Claude models only:</strong> Claude Haiku 5.5 and Claude Sonnet 5.5, through Claude Code. Other models may react differently.</li>\n" +
"<li><strong>One judge:</strong> Claude Opus 5.5, one score per attempt, for qualities tests cannot check. No number on this page rests on the judge.</li>\n" +
"<li><strong>12 tasks per topic</strong>, 10 attempts per task and arm.</li>\n" +
"<li><strong>Who wrote and checked the tasks.</strong> An OpenAI Codex agent (gpt-6-astra) wrote the tasks, hidden tests, reference solutions and planted bugs from the four topics alone, without seeing any rules file. Separate Claude review agents checked them blind. A fairness review then went through every failing check against real attempts, and fixed or removed unfair ones. Machine checks confirmed that every reference solution passes its hidden tests and that every planted bug can be caught.</li>\n" +
"<li><strong>Lost and re-run attempts.</strong> The test setup lost {{totals.lost}} of {{totals.planned}} attempts (crashes, out-of-memory kills, one timeout). In the Jest comparison, all {{totals.replaced}} lost attempts were re-run once, after their original runs, and all completed. In the other three topics, the {{totals.unreplaced}} lost attempts were not re-run, and those shares are over the attempts that completed (at most 3 lost per arm). Counting every lost attempt as a failure changes no conclusion.</li>\n" +
"<li><strong>Two pauses.</strong> The full run paused twice on a usage limit (20 Nov for about 25 minutes, and 21 to 23 Nov). Each run resumed from its saved progress.</li>\n" +
"<li><strong>The re-run comparison mixes date and run order.</strong> The original runs did each task's 10 attempts per arm as one block. The removal run interleaved the arms on a later day. So a gap between them could come from either.</li>\n" +
"</ul>\n" +
"</div>\n" +
"\n" +
"<h2>What removing the line showed</h2>\n" +
"<p>We ran the Jest tasks again on one day with three versions side by side: the file without that one line, the full file, and no file. Everything else stayed the same: the tasks, the planted bugs, the test setup, the models and the judge.</p>\n" +
"\n" +
"<div class=\"wrap\"><table>\n" +
"<thead><tr><th>Removal run, 120 attempts per cell</th><th>Without the line</th><th>Full file</th><th>No file</th></tr></thead>\n" +
"<tbody>\n" +
"<tr><td colspan=\"4\"><strong>Sonnet</strong></td></tr>\n" +
"<tr><td>Share of attempts that caught every bug</td><td>{{j.s.rm.alln}}</td><td>{{j.s.sr.alln}}</td><td>{{j.s.sb.alln}}</td></tr>\n" +
"<tr><td>Share of planted bugs caught</td><td>{{j.s.rm.bug}}</td><td>{{j.s.sr.bug}}</td><td>{{j.s.sb.bug}}</td></tr>\n" +
"<tr><td>Tests written per attempt (median)</td><td>{{j.s.rm.median}}</td><td>{{j.s.sr.median}}</td><td>{{j.s.sb.median}}</td></tr>\n" +
"<tr><td colspan=\"4\"><strong>Haiku</strong></td></tr>\n" +
"<tr><td>Share of attempts that caught every bug</td><td>{{j.h.rm.alln}}</td><td>{{j.h.sr.alln}}</td><td>{{j.h.sb.alln}}</td></tr>\n" +
"<tr><td>Share of planted bugs caught</td><td>{{j.h.rm.bug}}</td><td>{{j.h.sr.bug}}</td><td>{{j.h.sb.bug}}</td></tr>\n" +
"<tr><td>Tests written per attempt (median)</td><td>{{j.h.rm.median}}</td><td>{{j.h.sr.median}}</td><td>{{j.h.sb.median}}</td></tr>\n" +
"</tbody>\n" +
"<caption>Tests written are counted as in the first table: tests the model added, not the starter's 19.</caption>\n" +
"</table></div>\n" +
"\n" +
"<p>How far it goes, measure by measure. Each change below is in percentage points, with its 95% range (resampling the 12 tasks):</p>\n" +
"<ul>\n" +
"<li><strong>Sonnet, both measures: clear.</strong> Removing the line raised the share of attempts that caught every bug by {{c.s.remove.all.delta}} points ({{c.s.remove.all.lo}} to {{c.s.remove.all.hi}}), and the share of planted bugs caught by {{c.s.remove.bug.delta}} points ({{c.s.remove.bug.lo}} to {{c.s.remove.bug.hi}}).</li>\n" +
"<li><strong>Haiku, share of attempts that caught every bug: clear.</strong> It rose by {{c.h.remove.all.delta}} points ({{c.h.remove.all.lo}} to {{c.h.remove.all.hi}}).</li>\n" +
"<li><strong>Haiku, share of planted bugs caught: not shown.</strong> It rose by {{c.h.remove.bug.delta}} points, but the range runs from {{c.h.remove.bug.slo}} to {{c.h.remove.bug.shi}} and includes zero.</li>\n" +
"</ul>\n" +
"<p>Without the line, we could not tell the file apart from no file. Against no file on the same day, the differences were {{c.s.base.all.signed}} points (Sonnet) and {{c.h.base.all.signed}} points (Haiku) on the share of attempts that caught every bug, and {{c.s.base.bug.signed}} and {{c.h.base.bug.signed}} points on the share of planted bugs caught. Every one of those ranges includes zero. So the rest of the file neither helped nor hurt in a way we could detect.</p>\n" +
"<p>On the second day, no file gave nearly the same results: on the share of attempts that caught every bug, {{j.s.sb.all}} against {{j.s.ob.all}} for Sonnet and {{j.h.sb.all}} against {{j.h.ob.all}} for Haiku. The full file stayed far below no file but scored a little higher than in the original run: Sonnet's share of attempts that caught every bug was {{j.s.sr.all}} against {{j.s.or.all}} ({{c.s.drift.all.signed}} points, {{c.s.drift.all.lo}} to {{c.s.drift.all.hi}}), and Haiku's share of planted bugs caught was {{j.h.sr.bug}} against {{j.h.or.bug}} ({{c.h.drift.bug.signed}} points, {{c.h.drift.bug.lo}} to {{c.h.drift.bug.hi}}).</p>\n" +
"\n" +
"<h2>The file, and what the line does</h2>\n" +
"<p>The file is <code>rules/jest-unit-testing-cursorrules-prompt-file.mdc</code> in the <a href=\"https://github.com/PatrickJS/awesome-cursorrules\">awesome-cursorrules</a> list on GitHub. It last changed on 13 May 2026 (commit <code>4467ad4</code>). We used its text without the 5-line header (the <code>description</code>, <code>globs</code> and <code>alwaysApply</code> lines and their fences), which Cursor reads as settings rather than instructions. The line we removed is item 8:</p>\n" +
"<blockquote><code>**8** **Test Quantity**: Limit to 3-5 focused tests per file for maintainability</code></blockquote>\n" +
"<p>The line does what it says. It limits the number of tests to keep a test file maintainable, which is a fair goal. Each task asked for one test file, so the line applied directly. With the full file, the models wrote a median of {{j.h.or.median}} (Haiku) and {{j.s.or.median}} (Sonnet) tests in the main run, and {{j.h.sr.median}} each in the removal run. With no file, they wrote {{j.s.sb.median}} to {{j.h.sb.median}}. What nobody could see without measuring is the cost. Fewer tests left more planted bugs uncaught, and far fewer attempts caught every one.</p>\n" +
"<p class=\"muted\">In Cursor this file is set to attach automatically when a matching file is in context. We gave it as always-on text in every attempt, so we measured the text, not Cursor's choice of when to use it.</p>\n" +
"\n" +
"<h2>The other three files: we could not show any help</h2>\n" +
"<p>We measured three more files the same way, each on its own topic. The main measure here is the share of attempts where every hidden test passed. None of the files showed a gain over no file on that measure.</p>\n" +
"\n" +
"<div class=\"wrap\"><table>\n" +
"<thead><tr><th>File, topic</th><th>Model</th><th>No file</th><th>With file</th><th>Change, points (95% range)</th><th>Tasks scoring the same in every arm</th></tr></thead>\n" +
"<tbody>\n" +
"<tr><td>GitHub Copilot security instructions, security</td><td>Haiku</td><td>{{o.security.h.base}}</td><td>{{o.security.h.rule}}</td><td>{{o.security.h.change}}</td><td>{{o.security.h.same}} of 12</td></tr>\n" +
"<tr><td>GitHub Copilot security instructions, security</td><td>Sonnet</td><td>{{o.security.s.base}}</td><td>{{o.security.s.rule}}</td><td>{{o.security.s.change}}</td><td>{{o.security.s.same}} of 12</td></tr>\n" +
"<tr><td>Windsurf \"Honey\" rules, general code</td><td>Haiku</td><td>{{o.utilities.h.base}}</td><td>{{o.utilities.h.rule}}</td><td>{{o.utilities.h.change}}</td><td>{{o.utilities.h.same}} of 12</td></tr>\n" +
"<tr><td>Windsurf \"Honey\" rules, general code</td><td>Sonnet</td><td>{{o.utilities.s.base}}</td><td>{{o.utilities.s.rule}}</td><td>{{o.utilities.s.change}}</td><td>{{o.utilities.s.same}} of 12</td></tr>\n" +
"<tr><td>Cursor Python FastAPI rules, FastAPI</td><td>Haiku</td><td>{{o.fastapi.h.base}}</td><td>{{o.fastapi.h.rule}}</td><td>{{o.fastapi.h.change}}</td><td>{{o.fastapi.h.same}} of 12</td></tr>\n" +
"<tr><td>Cursor Python FastAPI rules, FastAPI</td><td>Sonnet</td><td>{{o.fastapi.s.base}}</td><td>{{o.fastapi.s.rule}}</td><td>{{o.fastapi.s.change}}</td><td>{{o.fastapi.s.same}} of 12</td></tr>\n" +
"</tbody>\n" +
"<caption>Share of attempts where every hidden test passed; 120 attempts per cell, less up to 3 lost. \"Tasks scoring the same in every arm\" counts tasks with an identical share under no file, the file, a same-length irrelevant text and same-length generic advice. Every one of those sat at 0% or at 100%.</caption>\n" +
"</table></div>\n" +
"\n" +
"<p><strong>Ceiling caveat:</strong> many tasks gave the same result whatever the model was given, either always passing or never passing, so on those tasks no file could have shown a gain. For Sonnet on security, that was {{o.security.s.same}} of 12 tasks. \"We could not show any help\" is what these numbers support. They do not show that the files cannot help.</p>\n" +
"<p>On the second measure, the share of hidden tests passed, one comparison cleared our bar. For Haiku, the Windsurf file scored {{o.utilities.h.rule.secondary}} points over no file ({{o.utilities.h.rule.range}}). Generic advice of the same length, written from the topic alone, scored {{o.utilities.h.generic.secondary}} ({{o.utilities.h.generic.range}}) on the same measure. So we cannot tie that gain to this file. </p>\n" +
"\n" +
"<h2>How we measured</h2>\n" +
"<ul>\n" +
"<li><strong>Tasks.</strong> 12 per topic, chosen from a pool of 68 by a rule fixed before any run: keep the tasks where no file scored closest to half. Each task is a small starter project of 4 to 10 files with a short, realistic prompt. Jest tasks ask for one test file covering a module; the other topics ask for code that hidden tests check for practices a careful engineer would follow unprompted.</li>\n" +
"<li><strong>Arms.</strong> No file; the rules file; a same-length irrelevant text (a placebo); and same-length generic advice on the topic, written without seeing the file.</li>\n" +
"<li><strong>Attempts.</strong> 10 per task and arm, per model, fresh each time.</li>\n" +
"<li><strong>Measures.</strong> Main: the share of attempts where every hidden test passed (for Jest: where every planted bug was caught). Second: the share of hidden tests passed (for Jest: the share of planted bugs caught). Both were fixed before the run.</li>\n" +
"<li><strong>Ranges.</strong> 95% ranges from 4,000 resamples of the 12 tasks, pairing each task's arms (seed 501). They are pointwise: with this many comparisons, an occasional range will clear zero by chance.</li>\n" +
"<li><strong>Cost.</strong> At list prices the calls would cost about USD 1,721 (USD 1,485 for the study and USD 236 for the removal run).</li>\n" +
"</ul>\n" +
"\n" +
"<h2>What you cannot reproduce yet</h2>\n" +
"<ul>\n" +
"<li>Re-running the models needs the runner, which arrives with a later release.</li>\n" +
"<li>Model output varies between runs. A re-run should land within the ranges, not repeat each attempt.</li>\n" +
"<li>The models are fixed versions: <code>claude-haiku-5-5</code> and <code>claude-sonnet-5-5</code>, with <code>claude-opus-5-5</code> as judge. They can be retired, and service behaviour can change.</li>\n" +
"<li>The test environment is a 444 MB pinned image (digest <code>5509c354…</code>, Claude Code 2.1.287). A rebuild may not match byte for byte.</li>\n" +
"<li>It needs Linux with sandboxing and a dedicated user.</li>\n" +
"<li>The judge also varies, though no number on this page rests on it.</li>\n" +
"<li>Re-running the calibration that chose the 12 tasks is a separate, paid exercise. The selection itself can be checked from the data.</li>\n" +
"</ul>\n" +
"\n" +
"<h2>Check it yourself</h2>\n" +
"<p>The twelve receipts are on Zenodo: <a data-external-receipts=\"receipts/report-021/manifest.json\" data-receipts-host=\"Zenodo\" href=\"https://doi.org/10.5281/zenodo.__ZENODO_RECORD__\">10.5281/zenodo.__ZENODO_RECORD__</a>.</p>\n" +
"<p>The <a href=\"https://github.com/driftproofhq/driftproof/tree/main/receipts/report-021\">report folder</a> contains the manifest with hashes, the three analysis outputs, the frozen task suite and the five rules texts. The Jest text is <code>c8c5f92e…</code>; without the line it is <code>c3bffb31…</code>.</p>\n" +
"<p>From a checkout of the public repository, download the twelve files and run the offline script. It refuses any file whose hash does not match. It also checks the JSON hash after decompression and the receipt hash, and refuses missing or extra files.</p>\n" +
"<pre><code>mkdir -p report-021-receipts\n" +
"{{downloads}}\n" +
"npm i --no-save @babel/parser@7.29.14\n" +
"node scripts/analyze-report-021.js --receipts report-021-receipts --check</code></pre>\n" +
"\n" +
"<h2>Run record</h2>\n" +
"<ul>\n" +
"<li>Main run: 20 to 23 Nov 2026 (UTC). 8 runs (4 files × 2 models), all complete.</li>\n" +
"<li>Removal run: 24 Nov 2026 (UTC), 2 runs, all complete. Re-runs of lost attempts: 24 Nov, 22:07 to 22:29 UTC.</li>\n" +
"<li>Rules texts as fetched for the study. Jest and FastAPI: awesome-cursorrules, last changed 13 May 2026. Security: <code>instructions/security-and-owasp.instructions.md</code> in github/awesome-copilot, commit <code>c835373</code> (2 Sep 2026). Honey: <code>.windsurf/rules/honey.md</code> in Green-PT/honey-for-devs, commit <code>6eb60f9</code> (18 Oct 2026). Front-matter headers were removed in each case.</li>\n" +
"</ul>\n" +
"\n" +
"<p class=\"muted\">Report #021. Driftproof measures whether a rules file or skill changes what a model does.</p>\n" +
"";
const SITE_NAV = "<!--driftproof:nav--><header class=\"site\">\n<a class=\"brand\" href=\"/\"><img class=\"brand-mark\" src=\"/favicon.svg\" alt=\"\" width=\"28\" height=\"28\"><span>Driftproof</span></a>\n<details class=\"nav-menu\"><summary>Menu</summary></details>\n<nav class=\"site-nav\" aria-label=\"Site\">\n<a href=\"/reports/\">Reports</a>\n<a href=\"/skills/\">Skills</a>\n<a href=\"/r/\">Receipts</a>\n<a href=\"/badges/\">Badges</a>\n<a href=\"/how-it-works/\">How it works</a>\n<details class=\"docs-menu\"><summary>For builders</summary><div class=\"docs-menu-list\">\n<a href=\"/#quickstart\">Install</a>\n<a href=\"/#how-it-works\">How a skill is tested</a>\n<a href=\"/benchmark-gap/\">Gap calculator</a>\n<a href=\"/leaderboard-noise/\">Leaderboard noise</a>\n<a href=\"/paper/\">Paper</a>\n<a href=\"/methodology/\">Methodology</a>\n<a href=\"/neutrality/\">Neutrality</a>\n<a href=\"/interop/\">Interop</a>\n<a href=\"/authoring/\">Authoring</a>\n<a href=\"/judge-policy/\">Judge policy</a>\n<a href=\"/findings/\">Findings</a>\n<a href=\"/how-this-is-built/\">How this is built</a>\n<a href=\"/glossary/\">Glossary</a>\n<a href=\"/report-types/\">Report types</a>\n</div></details>\n<a href=\"https://github.com/driftproofhq/driftproof\">GitHub</a>\n</nav>\n</header><!--/driftproof:nav-->";
function renderBody(data,manifest) {
 const values=pageValues(data),record=manifest.files[0].url.match(/\/records\/([^/]+)\//)[1];
 values.downloads=manifest.files.map(e=>`curl --fail --location '${e.url}' --output report-021-receipts/${e.file}`).join('\n');
 let out=BODY_TEMPLATE.replace(/\{\{([^}]+)\}\}/g,(_,key)=>{need(Object.hasOwn(values,key),'unbound report value '+key);return values[key];}).replaceAll('__ZENODO_RECORD__',record);
 const counterLine=fs.readFileSync(__filename,'utf8').slice(0,fs.readFileSync(__filename,'utf8').indexOf('function countTests(')).split('\n').length;
 out=out.replace('LCOUNTER_LINE','L'+counterLine);
 out=out.replace('<p class="lede">','<div class="headline"><p class="big">').replace('</p>\n\n<div class="wrap">','</p></div>\n\n<div class="wrap">');
 for(const model of MODELS)out=out.replace('<code>'+model+'</code>','<data data-row="model" value="'+model+'" data-src="receipts/report-021/manifest.json"><code>'+model+'</code></data>');
 out=out.replace('24 Nov 2026 (UTC), 2 runs','<data data-row="date" value="2026-11-24" data-src="docs/reports/021/index.html">24 Nov 2026</data> (UTC), 2 runs');
 // Captions lead table markup for HTML validity; CSS keeps them below the rows.
 out=out.replace(/<table>([^]*?)<caption>([^]*?)<\/caption>\s*<\/table>/g,
  (_,rows,caption)=>'<table><caption>'+caption+'</caption>'+rows+'</table>');
 out=out.replace(/<th>/g,'<th scope="col">');
 reportVerdicts(out,data);return out;
}
function checkPage(html,data,manifest) {
 const bodyHtml=html.replace(/<!--driftproof:tldr-->[^]*?<!--\/driftproof:tldr-->/g,'');
 const actual=bodyHtml.match(/<main\b[^>]*>([^]*?)<\/main>/)?.[1];need(actual!==undefined,'report page main missing');
 const expected=renderBody(data,manifest),numberTokens=s=>htmlText(s).match(/\d+(?:[.,:]\d+)*/g)||[];
 // Generated summary fields repeat the report's claims. They must also bind
 // to the computed text; stripping their fence must never hide a changed number.
 const summary=html.match(/<!--driftproof:tldr-->([^]*?)<!--\/driftproof:tldr-->/)?.[1]||'';
 for(const m of summary.matchAll(/<span class="tldr-(?:counts|verdict)">([^]*?)<\/span>/g))
  need(htmlText(expected).includes(htmlText(m[1])),'page number mismatch: report summary');
 for(const m of summary.matchAll(/<li><b>[^]*?<\/b>\s*([^]*?)<\/li>/g))
  need(htmlText(expected).includes(htmlText(m[1])),'page number mismatch: report summary point');
 const receiptSummary=summary.match(/<span class="tldr-receipts">([^]*?)<\/span>/)?.[1];
 if(receiptSummary!==undefined){
  const id=manifest.files[0].url.match(/\/records\/([^/]+)\//)[1];
  need(receiptSummary==='<a href="https://doi.org/10.5281/zenodo.'+id+'">'+manifest.files.length+' receipts on Zenodo</a>','page number mismatch: external receipts');
 }
 const a=numberTokens(actual),b=numberTokens(expected);
 need(canonical(a)===canonical(b),'page number mismatch: '+a.findIndex((x,i)=>x!==b[i]));
 need(htmlText(actual)===htmlText(expected),'page approved wording or verdict differs');
 need(!/specs\//.test(html),'page names private sources');checkClaimWording(html);checkZenodo(html,manifest);reportVerdicts(html,data);
 const section=actual.slice(actual.indexOf('<h2>The other three files:'),actual.indexOf('<h2>How we measured'));
 need(/we could not show any help/.test(section)&&/Ceiling caveat/.test(section),'page ceiling caveat location');
 need(/href="[^"]*analyze-report-021\.js#L\d+"[^>]*>Tests written<\/a>/.test(actual),'counter definition link missing');
 for(const e of manifest.files)need(actual.includes(e.url),'download command URL missing');
}
function buildPage(folder=REPORT,page=PAGE) {
 const manifest=read(path.join(folder,'manifest.json')),body=renderBody(archivedData(folder),manifest);
 const html='<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n'+
 '<title>Report 021: One line in a Jest rules file | Driftproof</title>\n<link rel="stylesheet" href="/style.css">\n'+
 '<style>.report021 table{border-collapse:collapse;width:100%;font-size:.9rem}.report021 th,.report021 td{padding:.5rem;border-bottom:1px solid var(--line);text-align:right}.report021 th:first-child,.report021 td:first-child{text-align:left}.report021 caption{caption-side:bottom;text-align:left;margin-top:1rem}.report021 .wrap{overflow-x:auto}.report021 .box{border:1px solid var(--line);padding:1.5rem;margin:2rem 0}.report021 pre{overflow-x:auto}.report021 blockquote{border-left:3px solid currentColor;padding-left:1rem}</style>\n</head>\n<body>\n'+SITE_NAV+'\n<main class="report shaped report021">'+body+'</main>\n<footer class="site"><p>Report #021 · Driftproof · Apache-2.0</p><p><a href="/reports/">Reports</a> · <a href="/methodology/">Methodology</a> · <a href="/neutrality/">Neutrality</a></p></footer>\n</body>\n</html>\n';
 fs.mkdirSync(path.dirname(page),{recursive:true});fs.writeFileSync(page,html);console.log('report 021 page: built from approved words and analysis');
}
function printTables(data) {
 for(const model of MODELS){console.log('\nJest '+model+' | attempts catching every bug | planted bugs caught | median tests written | observed / lost / re-run');
  for(const [name,a]of Object.entries(data.replacement[model].primary.arms))console.log(name+' | '+(100*a.all_caught_share).toFixed(1)+'% ('+a.all_caught+') | '+(100*a.pooled_bug_share).toFixed(1)+'% | '+a.median_generated_tests+' | '+a.observed+' / '+a.harness_lost+' / '+a.replaced);
  for(const [name,c]of Object.entries(data.replacement[model].primary.contrasts))console.log(name+' | '+['all_caught','bug_share'].map(k=>(100*c[k].delta).toFixed(1)+' ('+c[k].ci.map(v=>(100*v).toFixed(1)).join(' to ')+')').join(' | '));
  console.log('Loss-as-failure sensitivity '+model+' | '+Object.entries(data.replacement[model].sensitivity.arms).map(([name,a])=>name+': '+(100*a.all_caught_share).toFixed(1)+'%, '+(100*a.pooled_bug_share).toFixed(1)+'%, '+a.imputed_losses+' imputed').join(' | '));
 }
 console.log('\nOther files | model | no file | with file | paired points (95% range) | tasks the same in every arm');
 for(const r of data.main.filter(r=>r.topic!=='jest'))console.log(r.topic+' | '+r.model+' | '+(100*r.arms.baseline.share).toFixed(1)+'% | '+(100*r.arms.rule.share).toFixed(1)+'% | '+(100*r.overall.baseline.delta).toFixed(1)+' ('+r.overall.baseline.ci.map(x=>(100*x).toFixed(1)).join(' to ')+') | '+r.same);
 console.log('report 021 accounting: '+data.totals.planned+' planned; '+data.totals.lost+' original losses; '+data.totals.replaced+' re-run; '+(data.totals.lost-data.totals.replaced)+' unreplaced');
}
async function main(args=process.argv.slice(2)) {
 if(args[0]==='--set-zenodo-record'){need(args.length===2,'Zenodo record must contain only digits');return setZenodoRecord(args[1]);}
 if(args.length===1&&args[0]==='--build-page')return buildPage();
 const check=args.includes('--check'),filtered=args.filter(a=>a!=='--check');
 need(filtered.length===2&&filtered[0]==='--receipts'&&args.filter(a=>a==='--check').length<=1,'usage: --receipts <dir> [--check]');
 const manifest=read(path.join(REPORT,'manifest.json')),html=fs.readFileSync(PAGE,'utf8');verifySupport(REPORT);
 // Fail obvious corruptions cheaply, before reading hundreds of megabytes. This
 // preflight is never sufficient for success; the fresh receipt pass follows it.
 if(check)checkPage(html,archivedData(),manifest);
 const sources=[];
 await verifyReceiptFiles(filtered[1],manifest,async(r,e)=>{sources.push(reduceReceipt(r,e,REPORT));});
 const data=compute(sources);compareOutputs(data,REPORT);checkPage(html,data,manifest);printTables(data);
 console.log('report 021: PASS; 12 receipt hashes; 3 analysis outputs; all page numbers and ranges; verdict words');
 return data;
}
module.exports={htmlText,verifyReceiptFiles,assertComparable,scoreExecution,summarizeRows,contrastRows,replaceDraws,countTests,checkPageNumbers,checkAnalysis,checkClaimWording,checkVerdicts,checkZenodo,setZenodoRecord,verifySupport,writeSums,archivedData,pageValues,renderBody,buildPage,checkPage,reduceReceipt,compute,compareOutputs,validateSelection,main};
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
