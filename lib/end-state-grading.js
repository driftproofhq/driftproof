// SPDX-License-Identifier: Apache-2.0
'use strict';
// Issue 786. End-state-primary grading for the repository lane's tools-on mode: each task's check,
// frozen by hash, reads what Claude Code ended up doing and gives the primary score; the judge's
// grade of the reply is the secondary score and never enters the verdict (spec 786 AC-9, AC-10).
const {canonicalize,sha256}=require('./canonical'),{mean,stddev}=require('./stats');
const EG=require('./execution-grading');
const CONTRACT='end-state-v1';
const LIMITATIONS=['The primary score is a check written before any call, over the end state Claude Code left: files, tool calls, Skill calls and fixture state.','The secondary score is the judge\'s grade of the reply and captured text; it does not enter the verdict.'];
const TEXT_LIMIT=65536;
const fail=message=>Object.assign(Error(message),{code:'END_STATE_CONTRACT'});
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const eq=(a,b)=>canonicalize(a)===canonicalize(b);
function freezeBody(suite){return {contract:CONTRACT,draw_max:suite.draw_max,tasks:suite.tasks.map(t=>({id:t.id,threshold:t.threshold,check_sha256:t.check_sha256}))};}
function freezeHash(suite){return sha256(canonicalize(freezeBody(suite)));}
function validateEndStateSuite(suite,skill){
 if(!suite||suite.contract!==CONTRACT||!Array.isArray(suite.tasks)||!suite.tasks.length)throw fail('An end-state suite names its contract and its tasks.');
 const max=require('./sampling').SAMPLING;
 if(!Number.isInteger(suite.draw_max)||suite.draw_max<max.min||suite.draw_max>max.max)throw fail('The draw cap is outside the sampling rule.');
 for(const t of suite.tasks)if(typeof t.id!=='string'||typeof t.check!=='function'||!hex(t.check_sha256)||!(t.threshold>0&&t.threshold<=1))throw fail('Each task names its check, its hash and its threshold.');
 if(suite.freeze_hash!==freezeHash(suite))throw fail('End-state freeze hash differs.');
 if(skill&&!eq(skill.suite.cases.map(c=>c.id),suite.tasks.map(t=>t.id)))throw fail('End-state tasks are not the suite\'s cases.');
 return suite;
}
function assertEndStateRun(skill,opts,capture){
 if(!opts.endStateSuite)return null;
 const stub=require('./stub').stubEnabled();
 if(opts.executionSuite||capture!==require('./repository').TOOLS_ON_MODE||(!opts.checkpointDir&&!opts.resume&&!stub)||(opts.concurrency??1)!==1)
  throw fail('End-state grading requires the tools-on mode, a checkpoint, serial calls and no execution suite.');
 return validateEndStateSuite(opts.endStateSuite,skill);
}
// What the check reads. Built from the sealed snapshot, the stream's events, the hook's own record
// and the fixtures' state record; never from the reply's account of what it did.
function endStateOf(gen,task=null){
 // "Changed" is read against the starter the supervisor copied into this draw, which it reports.
 const base=Array.isArray(gen?.starter_manifest)?gen.starter_manifest.map(f=>({path:f.path,sha256:f.sha256})):require('./repository').repositoryManifest(require('./repository').STARTER).files.map(f=>({path:f.path,sha256:f.sha256}));
 const starter=new Map(base.map(f=>[f.path,f.sha256]));
 const files={},seen=new Set();
 for(const e of gen?.workspace_snapshot?.entries||[]){
  if(e.type!=='file')continue;
  const bytes=Buffer.from(e.base64,'base64'),text=bytes.length<=TEXT_LIMIT&&!bytes.includes(0)&&Buffer.from(bytes.toString('utf8')).equals(bytes)?bytes.toString('utf8'):null;
  files[e.path]={sha256:e.sha256,bytes:e.bytes,text};seen.add(e.path);
 }
 // Links are recorded, never followed on disk; a link inside the workspace also names the files under
 // its target, marked as read through the link (an install that links a skill folder).
 const links=(gen?.workspace_snapshot?.entries||[]).filter(e=>e.type==='symlink').map(e=>({path:e.path,target:e.target}));
 for(const l of links){
  if(l.target.startsWith('/'))continue;
  const to=require('node:path').posix.normalize(require('node:path').posix.join(require('node:path').posix.dirname(l.path),l.target));
  if(to==='..'||to.startsWith('../')||to==='.')continue;
  for(const [p,f] of Object.entries(files))if(p===to||p.startsWith(to+'/')){const v=l.path+p.slice(to.length);if(!files[v])files[v]={...f,via_link:true};}
 }
 const changed=[];
 for(const l of links)if(!starter.has(l.path))changed.push({path:l.path,change:'added_link'});
 for(const p of [...new Set([...starter.keys(),...seen])].sort()){
  if(!seen.has(p))changed.push({path:p,change:'deleted'});
  else if(!starter.has(p))changed.push({path:p,change:'added'});
  else if(starter.get(p)!==files[p].sha256)changed.push({path:p,change:'modified'});
 }
 const events=gen?.delivery?.tool_events||[],results=new Map(events.filter(e=>e.type==='tool_result').map(e=>[e.tool_use_id,e]));
 const tool_calls=events.filter(e=>e.type==='tool_use').map(e=>({id:e.id,name:e.name,input:e.input&&typeof e.input==='object'?e.input:{},ok:results.has(e.id)&&results.get(e.id).is_error!==true}));
 const skillName=i=>[i.skill,i.command,i.name].find(x=>typeof x==='string')?.replace(/^\//,'')??null;
 return {version:1,task,starter_sha256:sha256(canonicalize(base)),reply:String(gen?.text||''),complete:gen?.delivery?gen.delivery.complete===true:null,files,changed,links,tool_calls,
  skill_calls:tool_calls.filter(t=>t.name==='Skill'&&t.ok).map(t=>skillName(t.input)).filter(Boolean),
  hook_skill_calls:Array.isArray(gen?.hook_skill_calls)?gen.hook_skill_calls.map(r=>({tool_use_id:r.tool_use_id,skill:skillName(r.input||{})})):null,
  fixture:gen?.fixture_state??null};
}
function readCheck(task,state){
 let out;try{out=task.check(structuredClone(state));}catch{return null;}
 if(!out||typeof out.score!=='number'||!(out.score>=0&&out.score<=1)||!Array.isArray(out.criteria)||out.criteria.some(c=>typeof c?.name!=='string'||typeof c.pass!=='boolean'))return null;
 return {score:out.score,criteria:out.criteria.map(c=>({name:c.name,pass:c.pass}))};
}
// One draw's primary score, or the reason it is unmeasured. Never 0 for a state it could not read.
function scoreDraw(bundle,caseId,gen){
 const task=bundle.tasks.find(t=>t.id===caseId);if(!task)throw fail('No check for task '+caseId+'.');
 const stub=require('./stub').stubEnabled(),unmeasured=reason=>({status:'unmeasured',reason,check_sha256:task.check_sha256,score:null});
 if(!gen?.workspace_snapshot)return unmeasured('end_state_unreadable');
 if(!stub&&gen.delivery?.complete!==true)return unmeasured('incomplete_evidence');
 if(!stub&&!Array.isArray(gen.starter_manifest))return unmeasured('end_state_unreadable');
 const state=endStateOf(gen,caseId);
 if(!stub){
  // The hook admitted exactly the Skill calls the stream shows (spec 786 AC-11).
  const streamIds=state.tool_calls.filter(t=>t.name==='Skill').map(t=>t.id).sort(),hookIds=(state.hook_skill_calls||[]).map(r=>r.tool_use_id).sort();
  if(state.hook_skill_calls===null||!eq(streamIds,hookIds))return unmeasured('skill_record_mismatch');
 }
 const read=readCheck(task,state);if(!read)return unmeasured('check_error');
 const body={status:'measured',score:read.score,criteria:read.criteria,threshold:task.threshold,check_sha256:task.check_sha256,end_state_hash:sha256(canonicalize(state)),
  snapshot_hash:gen.workspace_snapshot.snapshot_hash||null,evidence_kind:stub?'simulated':'observed'};
 return {...body,result_hash:sha256(canonicalize(body))};
}
function primaryJudgeResult(jr,endState,c,mode,answerHash,judgeModel){
 const score=endState.score;
 return {...jr,unmeasured:false,caseResult:{id:c.id,mode,mean:score,score,stddev:0,samples:[score],generation_hash:answerHash,
  ...((jr.caseResult?.judge_sample_hashes||jr.sampleHashes||[]).length?{judge_sample_hashes:jr.caseResult?.judge_sample_hashes||jr.sampleHashes}:{}),threshold:endState.threshold,
  outcome:score>=endState.threshold?'pass':'fail',reason:'Frozen end-state check score.',judge:jr.caseResult?.judge||{model_id:judgeModel,rubric_hash:require('./judge').caseRubricHash(c)},
  ...((jr.caseResult?.judge_usage||jr.judge_usage)?{judge_usage:jr.caseResult?.judge_usage||jr.judge_usage}:{})}};
}
function scoringDescriptor(bundle){return {...freezeBody(bundle),freeze_hash:bundle.freeze_hash,secondary_role:'reply-judge',limitations:LIMITATIONS};}
// The sealed receipt's end-state evidence, read again from its own fields (spec 786 AC-13).
function endStateReceiptProblem(receipt){
 const s=receipt?.run?.scoring,rows=receipt?.results?.cases||[];
 try{
  if(s.contract!==CONTRACT||receipt.run.capture.mode!==require('./repository').TOOLS_ON_MODE||!eq(s.limitations,LIMITATIONS)||s.secondary_role!=='reply-judge'||s.freeze_hash!==sha256(canonicalize({contract:CONTRACT,draw_max:s.draw_max,tasks:s.tasks})))return 'End-state scoring identity differs.';
  if(!s.tasks.every(t=>hex(t.check_sha256)))return 'End-state check binding absent.';
  for(const c of rows){
   const task=s.tasks.find(t=>t.id===c.id);if(!task||c.score_basis!=='end-state')return 'Case scoring role differs.';
   if(c.generation.draws.length>s.draw_max)return 'More draws than the plan\'s cap.';
   for(const d of c.generation.draws){
    const e=d.end_state;
    if(d.status!=='measured'){if(e?.status==='measured')return 'Measured end state was discarded.';if(d.primary!==undefined&&d.primary!==null)return 'Unmeasured draw has a primary score.';continue;}
    if(!e||e.status!=='measured'||e.check_sha256!==task.check_sha256||e.threshold!==task.threshold)return 'End-state result binding differs.';
    const {result_hash,...body}=e;if(sha256(canonicalize(body))!==result_hash||!hex(e.end_state_hash))return 'End-state result hash differs.';
    if((receipt.run.surface==='stub')!==(e.evidence_kind==='simulated'))return 'End-state evidence kind differs.';
    if(d.primary!==e.score||d.mean!==e.score||d.stddev!==0||!eq(d.samples,[e.score]))return 'Primary score differs from the end state.';
    const q=d.secondary;if(!q||!['measured','unmeasured'].includes(q.status)||!eq(q.judge_sample_hashes,d.judge_sample_hashes||[]))return 'Secondary evidence absent.';
    if(q.status==='measured'&&(!q.samples.length||q.samples.length!==q.judge_sample_hashes.length||Math.abs(mean(q.samples)-q.mean)>1e-9||Math.abs(stddev(q.samples)-q.stddev)>1e-9))return 'Secondary arithmetic differs.';
   }
   const agg=require('./sampling').acrossDraws(c.generation.draws);
   if(c.generation.mean!==agg.mean||c.generation.n_measured!==agg.n_measured||c.generation.n_unmeasured!==agg.n_unmeasured)return 'Primary generation statistics differ.';
   if(agg.n_measured&&(c.primary!==agg.mean||c.mean!==agg.mean))return 'Case score differs from its draws.';
   if(!eq(c.secondary,EG.secondaryAcrossDraws(c.generation.draws)))return 'Secondary aggregate differs.';
  }
  const calc=require('./receipt').comparisonOf(rows,{comparative:receipt.run.scope?.kind!=='diagnostic'});
  if(!eq(receipt.comparison,calc.comparison))return 'End-state comparison differs.';
 }catch{return 'End-state evidence is incomplete.';}
 return null;
}
function endStateSummaryLines(receipt){
 const missing=receipt.results.cases.reduce((n,c)=>n+(c.secondary?.n_unmeasured||0),0);
 return ['Primary: a check written before any call, over the end state with tools on.','Secondary: the judge\'s grade of the reply; '+missing+' unmeasured draw assessment(s).',...LIMITATIONS];
}
module.exports={CONTRACT,LIMITATIONS,freezeHash,validateEndStateSuite,assertEndStateRun,endStateOf,scoreDraw,primaryJudgeResult,scoringDescriptor,
 secondaryGrade:EG.secondaryGrade,secondaryAcrossDraws:EG.secondaryAcrossDraws,endStateReceiptProblem,endStateSummaryLines};
