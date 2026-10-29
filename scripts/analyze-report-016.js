#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';
// Offline report 016 analysis. No model calls, workspace execution or network.
// node scripts/analyze-report-016.js [--root ROOT] [--out FILE]
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {canonicalize}=require('../lib/canonical');
const {validateReceipt,verifyReceiptHash}=require('../lib/receipt');
const {validateWorkspaceSnapshot}=require('../lib/workspace-snapshot');
const {receiptVerdict,placeboReading}=require('../lib/verdict');
const {buildPlaceboText}=require('../lib/placebo');
const TASKS=[{"id":"stable-dedup-js","location":"src/solution.cjs"},{"id":"parse-integer-python","location":"src/solution.py"},{"id":"merge-intervals-python","location":"src/solution.py"},{"id":"ttl-cache-js","location":"src/solution.cjs"},{"id":"bounded-map-js","location":"src/solution.cjs"},{"id":"retry-js","location":"src/solution.cjs"},{"id":"topological-sort-python","location":"src/solution.py"},{"id":"sql-parameters-python","location":"src/solution.py"},{"id":"csv-python","location":"src/solution.py"},{"id":"pagination-js","location":"src/solution.cjs"},{"id":"deep-merge-js","location":"src/solution.cjs"},{"id":"money-js","location":"src/solution.cjs"},{"id":"utc-day-python","location":"src/solution.py"},{"id":"utf8-stream-python","location":"src/solution.py"},{"id":"version-order-js","location":"src/solution.cjs"},{"id":"event-emitter-js","location":"src/solution.cjs"},{"id":"latest-row-sql","location":"src/solution.sql"},{"id":"result-type-typescript","location":"src/solution.ts"},{"id":"binary-search-js","location":"src/solution.cjs"},{"id":"safe-path-python","location":"src/solution.py"}];
const ROOT=path.resolve(__dirname,'..'),ARMS=['baseline','with_skill','placebo'];
const MODELS=['claude-haiku-5-5','claude-sonnet-5-5'];
const PINS={runner_sources:'83aedb18a8bff7cf93548a27cca5f322b8a5adef759dd34fcd0fac2d0afcae9f',picks:'5c653597203afa1bcae4afe067ec94fa5891df3687bd5a6520e33cdd44f6e22c',selection_notes:'a13dd3add8fda92404142f6f9f289a23e2a1155e2acfcf2d2b97789a2dc6af87',outcomes_note:'9ea1330142b80a69650c38e541fff304633baefcc071a1fb9638de0ba226e2d5'};
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const need=(ok,message)=>{if(!ok)throw Error('Report 016 evidence: '+message);};
const mean=a=>a.length?a.reduce((a,b)=>a+b,0)/a.length:null;
function safeRead(base,rel){
 need(typeof rel==='string'&&rel.length&&!path.isAbsolute(rel)&&!rel.includes('\\')&&!rel.split('/').some(x=>!x||x==='.'||x==='..'),'unsafe evidence path');
 let cur=base;for(const part of rel.split('/')){cur=path.join(cur,part);need(!fs.lstatSync(cur).isSymbolicLink(),'symlink in evidence path');}
 need(fs.statSync(cur).isFile(),'evidence is not a file');return fs.readFileSync(cur);
}
function bootstrap(diffs){
 if(!diffs.length)return null;let state=501;const next=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return(state>>>0)/4294967296;};
 const samples=Array.from({length:4000},()=>{let sum=0;for(let i=0;i<diffs.length;i++)sum+=diffs[Math.floor(next()*diffs.length)];return sum/diffs.length;}).sort((a,b)=>a-b);
 return[samples[100],samples[3900]];
}
function summarizeMetric(tasks){
 const ids=new Set(),included=[],excluded=[];
 for(const t of [...tasks].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)){
  need(!ids.has(t.id),'duplicate task');ids.add(t.id);const row={id:t.id,draws:{}};
  for(const arm of ARMS){const values=t[arm]||[];need(Array.isArray(values),'invalid metric draws');need(values.every(x=>x===null||Number.isFinite(x)),'invalid non-finite metric');const measured=values.filter(x=>x!==null);row[arm]=mean(measured);row.draws[arm]={eligible:measured.length,missing:values.length-measured.length};}
  if(ARMS.some(a=>row[a]===null))excluded.push({id:t.id,reason:'no eligible draws in '+ARMS.filter(a=>row[a]===null).join(', ')});else included.push(row);
 }
 const means=Object.fromEntries(ARMS.map(a=>[a,mean(included.map(t=>t[a]))]));
 const compare=arm=>{const diffs=included.map(t=>t.with_skill-t[arm]),delta=mean(diffs),ci=bootstrap(diffs),den=means[arm];return {mean:delta,ci,percent:den>0?delta/den*100:null,percent_ci:den>0&&ci?ci.map(x=>x/den*100):null,direction:ci&&ci[0]>0?'up':ci&&ci[1]<0?'down':'unclear'};};
 return{n:included.length,task_ids:included.map(t=>t.id),excluded,draws:included.map(t=>({id:t.id,...t.draws})),means,file_minus_placebo:compare('placebo'),file_minus_baseline:compare('baseline')};
}
// Preserve strings while removing comments. Newlines stay put for line counts.
function uncomment(text,ext){
 let out='',quote='',triple=false,block=false;
 for(let i=0;i<text.length;i++){
  const c=text[i],n=text[i+1];
  if(block){if(c==='*'&&n==='/'){block=false;out+='  ';i++;}else out+=c==='\n'?'\n':' ';continue;}
  if(quote){out+=c;if(c==='\\'&&ext!=='.sql'){out+=text[++i]||'';continue;}if(triple&&text.slice(i,i+3)===quote.repeat(3)){out+=text.slice(i+1,i+3);i+=2;quote='';triple=false;}else if(!triple&&c===quote){if(ext==='.sql'&&n===quote){out+=n;i++;}else quote='';}continue;}
  if(c==='"'||c==="'"||c==='\x60'){quote=c;triple=ext==='.py'&&text.slice(i,i+3)===c.repeat(3);out+=c;if(triple){out+=c+c;i+=2;}continue;}
  if(ext!=='.py'&&c==='/'&&n==='*'){block=true;out+='  ';i++;continue;}
  if((ext==='.py'&&c==='#')||(ext==='.sql'&&c==='-'&&n==='-')||(ext!=='.py'&&ext!=='.sql'&&c==='/'&&n==='/')){while(i<text.length&&text[i]!=='\n'){out+=' ';i++;}if(i<text.length)out+='\n';continue;}out+=c;
 }return out;
}
function snapshotMetrics(snapshot,{solutionPath,starterManifest,finalReply=null}){
 validateWorkspaceSnapshot(snapshot);const files=snapshot.entries.filter(e=>e.type==='file'),solution=files.find(e=>e.path===solutionPath);
 const code=e=>uncomment(Buffer.from(e.base64,'base64').toString('utf8'),path.extname(e.path));
 const loc=solution?code(solution).split(/\r?\n/).filter(x=>x.trim()).length:null;
 const wrote_tests=files.some(e=>/(^test[s]?\/|test)/i.test(e.path)&&!/__pycache__|\.pyc$/.test(e.path)&&!(starterManifest.files||[]).some(s=>s.path===e.path&&s.sha256===e.sha256)&&/\bassert(?:[A-Z]\w*)?\b|\bexpect\s*\(/.test(code(e)));
 return{loc,wrote_tests,no_solution:!solution,asked:solution?false:typeof finalReply==='string'?/\?/.test(finalReply):null};
}
function drawLosses(rows){
 const seen=new Set(),out={drawn:0,primary_execution:0,judge_only_primary:0,secondary_only:0,affected_draws:0};
 for(const c of rows){need(c.generation.n_drawn===c.generation.draws.length,'n_drawn count differs');for(const d of c.generation.draws){const id=c.id+'/'+c.mode+'/'+d.draw_index;need(!seen.has(id),'duplicate draw');seen.add(id);out.drawn++;
  const primary=d.status!=='measured',secondary=d.secondary?.status==='unmeasured';if(primary)out[c.score_basis==='judge-only'?'judge_only_primary':'primary_execution']++;else if(secondary)out.secondary_only++;
  if(primary||secondary)out.affected_draws++;
 }}return out;
}
function setupLookups(draws){
 const out={looked:0,total:draws.length,unknown:0};
 for(const d of draws){const evidence=d.delivery;if(!evidence?.complete||!Array.isArray(evidence.tool_events)){out.unknown++;continue;}
  if(evidence.tool_events.some(e=>e.type==='tool_use'&&['Bash','Read','Glob','Grep'].includes(e.name)&&['command','file_path','path','pattern'].some(k=>typeof e.input?.[k]==='string'&&/claude-progress|feature_list|(?:^|[\s/"'])init\.sh\b|\bgit(?:\s+-C\s+\S+)?\s+log\b|session-handoff/.test(e.input[k]))))out.looked++;
 }return out;
}
function conditions(r){const j=r.run.judge;return {suite:r.suite,scoring:r.run.scoring,capture:r.run.capture,harness:r.run.harness,provider:r.run.provider,surface:r.run.surface,delivery:r.run.delivery,timeout_ms:r.run.timeout_ms,scope:r.run.scope,judge:{model_id:j.model_id,surface:j.surface,sampling:j.sampling,temperature:j.temperature,samples:j.samples,prompt_template_hash:j.prompt_template_hash,harness:j.harness},rows:r.results.cases.map(c=>({id:c.id,mode:c.mode,threshold:c.threshold,judge:c.judge,score_basis:c.score_basis}))};}
function sourceMapHash(jobs){return hash(canonicalize(jobs.map(j=>[j.receipt_hash,j.source||null]).sort(([a],[b])=>a<b?-1:a>b?1:0)));}
function sourceProvenance(receipt,checkpoint){
 const c=checkpoint,payload={binding:c.binding,draws:c.draws,attempts:c.attempts,local_phases:c.local_phases||{},local_attempts:c.local_attempts||[],segments:c.segments};
 const digest=hash(canonicalize(payload));need(digest===receipt.run.checkpoint_evidence_hash,'runner checkpoint evidence hash');
 need(/^[0-9a-f]{40}$/.test(c.binding.runner_commit)&&/^[0-9a-f]{64}$/.test(c.binding.source_hash),'runner source identity');
 return {runner_commit:c.binding.runner_commit,source_hash:c.binding.source_hash,checkpoint_evidence_hash:digest};
}
function importEvidence({input,picks,subjects,notes,outcomes,root=ROOT}){
 const pickDoc=JSON.parse(fs.readFileSync(picks,'utf8'));need(hash(canonicalize(pickDoc.picks))===PINS.picks,'selection source pin');
 const base=path.join(root,'receipts/report-016'),manifest={version:1,reproduction_release:'0.24.0',stars_read_at:pickDoc.stars_read_at,picks:pickDoc.picks,jobs:[],subjects:{}};
 const copies=[],snapshotCopies=new Map();
 for(const [key,src] of [['selection_notes',notes],['outcomes_note',outcomes]]){const b=fs.readFileSync(src);need(hash(b)===PINS[key],key+' pin');manifest[key]={path:key.replaceAll('_','-')+'.md',sha256:hash(b)};copies.push([manifest[key].path,b]);}
 for(const p of pickDoc.picks){const b=fs.readFileSync(path.join(subjects,p.slot,p.kind+'.md'));need(hash(b)===p.sha256,'subject source hash');const rel='subjects/'+p.slot+'.txt';manifest.subjects[p.slot]=rel;copies.push([rel,b]);}
 for(const model of MODELS)for(const p of pickDoc.picks){const dir=path.join(input,model+'-'+p.slot),names=fs.readdirSync(dir).filter(f=>/^receipt-.*\.json$/.test(f));need(names.length===1,'one receipt per job');const b=fs.readFileSync(path.join(dir,names[0])),r=JSON.parse(b);need(validateReceipt(r).valid&&verifyReceiptHash(r),'source receipt schema or hash');
  const rel=names[0];copies.push([rel,b]);manifest.jobs.push({slot:p.slot,model,receipt:rel,receipt_hash:r.receipt_hash,sha256:hash(b),source:sourceProvenance(r,JSON.parse(fs.readFileSync(path.join(dir,'checkpoint.json')))),conditions:conditions(r)});
  for(const c of r.results.cases)for(const d of c.generation.draws){if(!d.snapshot_hash)continue;const name='workspace-'+d.snapshot_hash+'.json',bytes=fs.readFileSync(path.join(dir,name));const snap=JSON.parse(bytes);validateWorkspaceSnapshot(snap,r.run.capture.runtime_image_digest);need(snap.snapshot_hash===d.snapshot_hash,'snapshot identity');snapshotCopies.set(name,bytes);}
 }
 need(sourceMapHash(manifest.jobs)===PINS.runner_sources,'runner source manifest hash');
 // Verify all inputs before writing. Original receipt and snapshot bytes are retained.
 const snapshotBytes=Buffer.concat([...snapshotCopies].sort(([a],[b])=>a<b?-1:1).map(([,bytes])=>bytes));manifest.snapshots={path:'snapshots.jsonl',sha256:hash(snapshotBytes)};copies.push([manifest.snapshots.path,snapshotBytes]);
 fs.mkdirSync(base,{recursive:true});fs.rmSync(path.join(base,'snapshots'),{recursive:true,force:true});for(const [rel,b] of copies){const file=path.join(base,rel);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,b);}
 fs.writeFileSync(path.join(base,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');return manifest;
}
function analyzeReport({root=ROOT}={}){
 const base=path.join(root,'receipts/report-016');need(fs.existsSync(base),'manifest directory missing');need(!fs.lstatSync(base).isSymbolicLink(),'symlink evidence root');
 const m=JSON.parse(safeRead(base,'manifest.json'));need(m.reproduction_release==='0.24.0','reproduction release');need(m.version===1&&Array.isArray(m.jobs)&&m.jobs.length===14,'campaign population must be 14');need(sourceMapHash(m.jobs)===PINS.runner_sources,'runner source manifest hash');need(hash(canonicalize(m.picks))===PINS.picks,'selection hash');
 for(const key of ['selection_notes','outcomes_note'])need(m[key]?.sha256===PINS[key]&&hash(safeRead(base,m[key].path))===PINS[key],key+' bytes hash');
 const subjects={};for(const p of m.picks){const b=safeRead(base,m.subjects[p.slot]);need(hash(b)===p.sha256&&b.length===p.bytes,'subject bytes hash');subjects[p.slot]=b.toString('utf8');}
 const quotes={"claude-1":"Minimum code that solves the problem. Nothing speculative.","claude-2":"启用「ultrathink」深度思考","claude-3":"Prioritize reliable completion, continuity across sessions, and explicit verification over speed.","claude-4":"Thorough in reasoning, concise in output.","agents-1":"You solve the whole problem with the least new code.","agents-2":"The goal is not to maximize raw code output.","agents-3":"the quality lives in the structure, the evidence, and the honesty"};
 for(const [slot,quote] of Object.entries(quotes))need(subjects[slot].replace(/\s+/g,' ').includes(quote),'quote differs from pinned subject');
 const expected=new Set(m.picks.flatMap(p=>MODELS.map(model=>p.slot+'/'+model))),identities=new Set(),receipts=[];
 for(const j of m.jobs){need(expected.delete(j.slot+'/'+j.model),'duplicate or unexpected campaign job');need(!identities.has(j.receipt_hash),'duplicate receipt hash');identities.add(j.receipt_hash);const bytes=safeRead(base,j.receipt);need(hash(bytes)===j.sha256,'receipt bytes hash');const r=JSON.parse(bytes);
  need(verifyReceiptHash(r)&&r.receipt_hash===j.receipt_hash,'receipt seal');const valid=validateReceipt(r);need(valid.valid,'receipt schema: '+JSON.stringify(valid.errors?.slice(0,2)));const pick=m.picks.find(p=>p.slot===j.slot);
  need(j.source.checkpoint_evidence_hash===r.run.checkpoint_evidence_hash,'runner checkpoint receipt binding');
  need(r.skill.content_hash===pick.sha256&&r.run.model_id===j.model,'receipt subject or model');need(canonicalize(conditions(r))===canonicalize(j.conditions),'comparison conditions differ');
  need(r.verification_level==='TESTED'&&r.run.answered_by?.kind==='model'&&r.run.surface==='claude-cli'&&r.run.delivery==='injected','receipt execution boundary');
  need(canonicalize([...r.run.scope.expected_arms].sort())===canonicalize([...ARMS].sort()),'expected arms');need(r.results.cases.length===r.run.scope.task_ids.length*ARMS.length,'complete task/arm population');
  const fake=buildPlaceboText(r.placebo.bytes,r.placebo.seed,r.placebo.corpus,r.placebo.revision);need(hash(fake)===r.placebo.sha256,'placebo bytes hash');receipts.push({j,r,fake});
 }
 need(!expected.size,'missing campaign job');
 const snapshotBytes=safeRead(base,m.snapshots.path);need(hash(snapshotBytes)===m.snapshots.sha256,'snapshot bundle hash');const bundle=new Map();for(const line of snapshotBytes.toString('utf8').trim().split('\n')){const doc=JSON.parse(line);need(!bundle.has(doc.snapshot_hash),'duplicate snapshot in bundle');bundle.set(doc.snapshot_hash,doc);}
 const jobs=receipts.map(({j,r,fake})=>{
  const per=new Map(r.run.scope.task_ids.map(id=>[id,Object.fromEntries(ARMS.map(a=>[a,[]]))]));const snapshots=new Map(),unknownUsage=[],lost=[];
  const rows=r.results.cases;
  const setupEvent=rows.filter(c=>c.mode==='with_skill').flatMap(c=>c.generation.draws).flatMap(d=>d.delivery?.tool_events||[]).find(e=>e.type==='tool_use'&&e.name==='Bash'&&/claude-progress/.test(e.input?.command||''));
  for(const c of rows)for(const d of c.generation.draws){let metrics=null;
   if(d.snapshot_hash){let s=snapshots.get(d.snapshot_hash);if(!s){s=bundle.get(d.snapshot_hash);need(s,'snapshot missing from bundle');validateWorkspaceSnapshot(s,r.run.capture.runtime_image_digest);need(s.snapshot_hash===d.snapshot_hash,'snapshot draw binding');snapshots.set(d.snapshot_hash,s);}
    const solution=TASKS.find(t=>t.id===c.id);need(solution,'unknown task location');
    metrics=snapshotMetrics(s,{solutionPath:solution.location,starterManifest:r.run.capture.starter_manifest,finalReply:null});
   }
   if(d.status!=='measured'||d.secondary?.status==='unmeasured')lost.push({task:c.id,arm:c.mode,draw:d.draw_index,primary:d.status!=='measured',basis:c.score_basis,secondary:d.secondary?.status==='unmeasured'});
   if(d.status!=='measured')continue;
   need(metrics,'measured draw snapshot missing');const output=d.usage?.output_tokens??null;need(output===null||Number.isFinite(output)&&output>=0,'invalid output usage');if(output===null)unknownUsage.push({task:c.id,arm:c.mode,draw:d.draw_index});
   per.get(c.id)[c.mode].push({...metrics,out:output,tool_calls:d.delivery?.tool_calls??null});
  }
  const metric=key=>summarizeMetric([...per].map(([id,arms])=>({id,...Object.fromEntries(ARMS.map(a=>[a,arms[a].map(d=>typeof d[key]==='boolean'?Number(d[key]):d[key])]))})));
  const hasUnknownAsk=[...per.values()].some(arms=>ARMS.some(a=>arms[a].some(d=>d.asked===null)));
  const tasks=r.run.scoring.primary_case_ids.map(id=>{const arms=Object.fromEntries(ARMS.map(mode=>{const c=rows.find(c=>c.id===id&&c.mode===mode),draws=c.generation.draws,measured=draws.filter(d=>d.status==='measured');return [mode,{drawn:draws.length,measured:measured.length,lost:draws.length-measured.length,pass_rate:mean(measured.map(d=>d.execution.pass_rate)),perfect:measured.filter(d=>d.execution.pass_rate===1).length,scores:measured.map(d=>d.execution.pass_rate)}];}));return {id,...arms,ceiling:ARMS.every(a=>arms[a].measured>0&&arms[a].perfect===arms[a].measured)};});
  const usageFields=[...new Set(rows.flatMap(c=>c.generation.draws.flatMap(d=>Object.keys(d.usage||{}))))].sort();
  return {slot:j.slot,model:j.model,receipt:j.receipt,receipt_hash:j.receipt_hash,date:r.run.date_utc,verification:r.verification_level,incomplete:Boolean(r.run.incomplete||r.run.scope.incomplete||receiptVerdict(r).notMeasured?.includes('incomplete')),
   correctness:{baseline:receiptVerdict(r),placebo:placeboReading(r),ceiling:tasks.filter(t=>t.ceiling).length,total:tasks.length,tasks},
   metrics:{out:metric('out'),loc:metric('loc'),tests:metric('wrote_tests'),missing_solution:metric('no_solution'),asking:hasUnknownAsk?{unavailable:'No hash-verified final reply is available in this evidence bundle.'}:metric('asked'),tool_calls:metric('tool_calls')},
   losses:drawLosses(rows),lost_draws:lost,lookups:Object.fromEntries(ARMS.map(mode=>[mode,setupLookups(rows.filter(c=>c.mode===mode).flatMap(c=>c.generation.draws))])),
   setup_example:setupEvent?.input.command||null,
   usage:{fields:usageFields,thinking:'The recorded usage fields do not establish whether output tokens include thinking tokens.',unknown:unknownUsage},
   placebo:{bytes:r.placebo.bytes,sha256:r.placebo.sha256,text:fake,skill_tokens_estimate:r.placebo.skill_tokens_estimate,tokens_estimate:r.placebo.tokens_estimate},
   settings:{runner_commit:j.source.runner_commit,source_hash:j.source.source_hash,harness:r.run.harness,limits:r.run.capture.limits,judge:r.run.judge.model_id,freeze:r.run.scoring.freeze_hash,suite:r.suite.suite_hash,runtime:r.run.capture.runtime_image_digest,environment:r.run.capture.effective_environment_hash,starter:r.run.capture.starter_hash},
  };
 });
 const sums=Object.fromEntries(Object.keys(jobs[0].losses).map(k=>[k,jobs.reduce((n,j)=>n+j.losses[k],0)]));
 return {version:1,method:{reproduction_release:m.reproduction_release,seed:501,bootstrap_samples:4000,resampling:'paired task differences; xorshift32; endpoints floor(B*.025), floor(B*.975)',eligibility:'Measured draws with verified snapshots; complete tasks across all three arms per metric; missing remains missing.',percentage:'Difference and endpoints divided by the comparator task mean; denominator treated as fixed.'},picks:m.picks,stars_read_at:m.stars_read_at,subjects,quotes,provenance:{outcomes_note:m.outcomes_note,selection_notes:m.selection_notes},jobs,totals:{...sums,ceiling:jobs.reduce((s,j)=>s+j.correctness.ceiling,0),tested_task_jobs:jobs.reduce((s,j)=>s+j.correctness.total,0)}};
}
function main(){const args=process.argv.slice(2),value=k=>{const i=args.indexOf(k);return i<0?undefined:args[i+1];};const root=value('--root')||ROOT;
 if(args.includes('--import')){importEvidence({root,input:value('--import'),picks:value('--picks'),subjects:value('--subjects'),notes:value('--notes'),outcomes:value('--outcomes')});console.log('report 016: imported original receipts and bound evidence');return;}
 const bytes=JSON.stringify(analyzeReport({root}),null,2)+'\n',out=value('--out');if(out){fs.writeFileSync(out+'.tmp',bytes);fs.renameSync(out+'.tmp',out);}else process.stdout.write(bytes);
}
module.exports={summarizeMetric,snapshotMetrics,setupLookups,drawLosses,analyzeReport};if(require.main===module)try{main();}catch(e){console.error(e.message);process.exitCode=1;}
