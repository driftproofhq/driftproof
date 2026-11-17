#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';
// Issue 816. Planning is local. The worker installs its durable, serial call boundary
// before loading either the runner or judge, so generation and parse retries share it.
const fs=require('node:fs'),path=require('node:path');
const {canonicalize,sha256}=require('../lib/canonical');
const ROOT=path.resolve(__dirname,'..');
const SOURCE='specs/783-fable-5-2-scope/placebo/plan.json';
const SOURCE_HASH='e557c3b4a5849ccfff353352a55c28742becdb5cb51be68fe9b06d0ebb7171ce';
const fail=code=>{throw Object.assign(Error(code),{code});};
const need=(ok,code)=>{if(!ok)fail(code);};
const same=(a,b)=>canonicalize(a)===canonicalize(b);
const hashDocument=(doc,key)=>{const copy={...doc};delete copy[key];return sha256(canonicalize(copy));};
const sealed=(doc,key)=>({...doc,[key]:hashDocument(doc,key)});
const read=f=>JSON.parse(regular(f));
function regular(f){const s=fs.lstatSync(f);need(s.isFile()&&!s.isSymbolicLink(),'FILE_TYPE');return fs.readFileSync(f);}
function write(f,doc){require('../lib/checkpoint').atomicFile(f,JSON.stringify(doc,null,2)+'\n');}
function surfaceGate(env=process.env){
 need(!Object.keys(env).some(k=>k.startsWith('ANTHROPIC_')),'SUBSCRIPTION_ONLY');
 need(!env.CLAUDE_PROVIDER||env.CLAUDE_PROVIDER==='cli','SUBSCRIPTION_ONLY');
 for(const k of ['CLAUDE_CODE_USE_BEDROCK','CLAUDE_CODE_USE_VERTEX','CLAUDE_CODE_USE_FOUNDRY','CLAUDE_CODE_EFFORT_LEVEL','DRIFTPROOF_REGISTRY','DRIFTPROOF_MODEL_REGISTRY','DRIFTPROOF_EVAL_USER','DRIFTPROOF_CLAUDE_BIN','NODE_OPTIONS'])need(!env[k],'SUBSCRIPTION_ONLY');
}
function outputDirectory(given){
 need(typeof given==='string'&&given.length>0,'OUTPUT_DIRECTORY');
 const absolute=path.resolve(given);let parent=absolute,tail=[];
 while(!fs.existsSync(parent)){tail.unshift(path.basename(parent));const next=path.dirname(parent);need(next!==parent,'OUTPUT_DIRECTORY');parent=next;}
 const resolved=path.join(fs.realpathSync(parent),...tail),root=fs.realpathSync(ROOT);
 need(resolved!==root&&!resolved.startsWith(root+path.sep),'OUTPUT_DIRECTORY');
 return resolved;
}
function rosterSource(){const bytes=regular(path.join(ROOT,SOURCE));need(sha256(bytes)===SOURCE_HASH,'ROSTER_BINDING');const p=JSON.parse(bytes);need(p.rows.length===20&&p.execution.attempts.length===20,'ROSTER_BINDING');return p;}
function stubText(row){return '---\nname: '+row.protocol.skill+'\n---\nCanned input for the release-day stub. No model measures this text.\n';}
function rosterOf(){const p=rosterSource();return p.execution.attempts.map((a,i)=>({rank:i+1,source_attempt:a.attempt_id,protocol:a.protocol,router:p.rows[i].router,handoff:p.rows[i].handoff,suite:p.rows[i].suite}));}
function codePins(){
 const files=['config.js','config/models.json','scripts/release-day-report.js','scripts/skill-handoff.js','specs/408-skill-measurements/campaign.cjs','specs/408-skill-measurements/eval-audit.cjs','specs/613-placebo-skills-report/tally.cjs','specs/783-fable-5-2-scope/price.cjs'];
 function walk(rel){for(const e of fs.readdirSync(path.join(ROOT,rel),{withFileTypes:true})){const f=rel+'/'+e.name;if(e.isDirectory())walk(f);else if(/\.(?:js|cjs|mjs|json)$/.test(f))files.push(f);}}
 walk('lib');return Object.fromEntries(files.sort().map(f=>[f,sha256(regular(path.join(ROOT,f)))]));
}
function registryFor(models){
 const registry=read(path.join(ROOT,'config/models.json'));
 for(const model of models){need(/^claude-[a-z0-9][a-z0-9._-]{0,100}$/.test(model),'MODEL_ID');
  if(!registry.models.some(r=>r.id===model))registry.models.push({id:model,family:'release-day',provider:'anthropic',released:null,input_price:10,output_price:50,tier:'frontier',judge_eligible:false,price_estimate:true,price_note:'DEFAULT_PRICE estimate; no published price was read'});
 }
 return registry;
}
function contractFor(stub){
 const source=rosterSource(),judge=require('../lib/judge');
 return {source:SOURCE,source_hash:SOURCE_HASH,judge:source.judge,samples:source.samples,judge_parse_retry_limit:JUDGE_PARSE_RETRY_LIMIT,sampling:require('../lib/sampling').SAMPLING,capture:'text',arms:source.arm_names,placebo:source.placebo,
  runner_version:require('../config').RUNNER_VERSION,cli_version:stub?'stub':require('../specs/783-fable-5-2-scope/price.cjs').cliVersion(),
  settings_hash:source.execution.settings_sha256,judge_code:judge.JUDGE_CODE_REVISION,judge_settings:judge.judgeSettings(source.samples,source.judge),
  prompt_hash:judge.promptTemplateHash(),criteria_hash:judge.criteriaTemplateHash(),effort:'CLI default; no override',code:codePins()};
}
// gradeOnce in the pinned judge makes one identical retry on a parse failure.
// The regression plant observes that bound through the actual judge, including two bad replies.
const JUDGE_PARSE_RETRY_LIMIT=1;
function jobCallLimit(contract){
 need(contract.judge_parse_retry_limit===JUDGE_PARSE_RETRY_LIMIT,'RETRY_LIMIT_BINDING');
 return 3*contract.arms.length*contract.sampling.max*(1+contract.samples*(1+contract.judge_parse_retry_limit));
}
const number=n=>Math.round(n*1e6)/1e6;
function buildPlan({model,cap,stub=false,prior=null,addModel=null}={}){
 need(Number.isFinite(cap)&&cap>0,'CAP_VALUE');
 const roster=rosterOf(),contract=contractFor(stub);need(contract.cli_version,'CLI_PREFLIGHT');
 if(prior){need(prior.plan.stub===stub,'MODE_BINDING');need(same(prior.plan.contract,contract),'GRADER_BINDING');model=prior.plan.model;}
 need(!addModel||prior,'DEEPEN_REQUIRED');
 const models=prior?[...prior.plan.models]:[model];if(addModel){need(!models.includes(addModel),'MODEL_EXISTS');models.push(addModel);}
 const registry=registryFor([...models,contract.judge]);const version=prior?prior.plan.version+1:1;
 const chosen=prior?prior.report.rows.filter(r=>['UNDERPOWERED','INCONCLUSIVE'].includes(r.reading)).map(r=>({rank:r.rank,model:r.model})):roster.map(r=>({rank:r.rank,model}));
 if(addModel)chosen.push(...roster.map(r=>({rank:r.rank,model:addModel})));
 const jobs=chosen.map(r=>({...r,id:sha256(canonicalize({version,...r,contract_hash:sha256(canonicalize(contract))}))}));
 const price=m=>{const row=registry.models.find(r=>r.id===m);need(row&&row.provider==='anthropic','SUBSCRIPTION_ONLY');return {input:row.input_price,output:row.output_price,estimate:!!row.price_estimate};};
 const prices=Object.fromEntries([...models,contract.judge].map(m=>[m,price(m)]));
 const perJob=(m,gradeAttempts=1)=>{const p=prices[m],j=prices[contract.judge];return 3*contract.sampling.max*((2*3000*2+250*2)*p.input+3*900*p.output+3*contract.samples*gradeAttempts*(1300*2*j.input+200*j.output))/1e6;};
 const calls=jobs.length*3*contract.arms.length*contract.sampling.max*(1+contract.samples),estimate=number(jobs.reduce((n,r)=>n+perJob(r.model),0));
 const callCeiling=jobs.length*jobCallLimit(contract),estimateWithRetries=number(jobs.reduce((n,r)=>n+perJob(r.model,1+contract.judge_parse_retry_limit),0));
 const rate=prior?.report.first_rate;
 if(prior&&calls)need(rate&&rate.calls>0&&rate.elapsed_ms>0,'FIRST_RATE_MISSING');
 const plan={format:'driftproof-release-day-plan/1',created_at:new Date().toISOString(),version,stub,model,models,contract,contract_hash:sha256(canonicalize(contract)),roster,registry,prices,cap_usd:cap,
  previous:prior?{plan_hash:prior.plan.plan_hash,report_hash:prior.report.report_hash}:null,jobs,
  estimates:{calls,call_ceiling:callCeiling,retry_calls:callCeiling-calls,usd:estimate,usd_with_retries:estimateWithRetries,ceiling_usd:cap,prior_reserved_usd:prior?.report.accounting?.reserved||0,prior_observed_usd:prior?.report.accounting?.observed||0,wall_seconds:rate?Math.ceil(calls*rate.elapsed_ms/rate.calls/1000):null,wall_ceiling_seconds:rate?Math.ceil(callCeiling*rate.elapsed_ms/rate.calls/1000):null,rate:rate||null,
   basis:'Fixed token estimate: twice list input plus list output. Before each call, reserve actual prompt bytes plus 3000 input tokens and 4096 output tokens at those rates. Cap covers estimated admissions; observed usage is separate and the last response can exceed its estimate.'}};
 return sealed(plan,'plan_hash');
}
function validatePlan(p,{live=true}={}){
 need(p?.format==='driftproof-release-day-plan/1'&&p.plan_hash===hashDocument(p,'plan_hash'),'PLAN_BINDING');
 need(same(p.roster,rosterOf()),'ROSTER_BINDING');need(p.contract.source_hash===SOURCE_HASH&&p.contract_hash===sha256(canonicalize(p.contract)),'PLAN_BINDING');
 if(live)need(same(p.contract.code,codePins()),'CODE_BINDING');
 need(p.contract.judge_parse_retry_limit===JUDGE_PARSE_RETRY_LIMIT,'RETRY_LIMIT_BINDING');
 need(p.contract.judge===rosterSource().judge&&p.contract.samples===5&&same(p.contract.arms,['with_skill','baseline','placebo']),'PLAN_BINDING');
 need(p.models.includes(p.model)&&p.cap_usd>0&&Number.isFinite(p.cap_usd),'PLAN_BINDING');
 if(p.version===1)need(same(p.jobs.map(({rank,model})=>({rank,model})),p.roster.map(r=>({rank:r.rank,model:p.model})))&&same(p.models,[p.model]),'ROSTER_BINDING');
 need(new Set(p.jobs.map(j=>j.id)).size===p.jobs.length,'JOB_BINDING');
 for(const j of p.jobs)need(p.models.includes(j.model)&&p.roster[j.rank-1]?.rank===j.rank&&j.id===sha256(canonicalize({version:p.version,rank:j.rank,model:j.model,contract_hash:p.contract_hash})),'JOB_BINDING');
 return p;
}
function approval(p,hash){need(hash===p.plan_hash,'APPROVAL_HASH');}
function inputSkill(p,row,inputs){
 const {suiteIdentity,parseSkillMeta}=require('../lib/skill');const {sha256Files}=require('../lib/canonical');
 const bytes=p.stub?Buffer.from(stubText(row)):regular(path.join(inputs,row.source_attempt+'.md'));
 need(p.stub||sha256(bytes)===row.protocol.skill_sha256,'SKILL_BYTES');
 const suiteBytes=regular(path.join(ROOT,'specs/408-skill-measurements',row.suite));
 need(sha256(suiteBytes)===row.protocol.evals_sha256,'SUITE_BINDING');
 const suite=suiteIdentity(JSON.parse(suiteBytes));need(suite.suiteHash===row.protocol.suite_hash&&suite.cases.length===3,'SUITE_BINDING');
 const meta=parseSkillMeta(bytes.toString());need(meta.name===row.protocol.skill,'SKILL_NAME');
 return {name:meta.name,version:meta.version||'0.0.0',skillMd:bytes.toString(),contentHash:sha256Files([{path:'SKILL.md',bytes}]),suite:{format:'agentskills.io/evals',suiteHash:suite.suiteHash,caseCount:3,cases:suite.cases}};
}
function preflight(p,inputs){
 validatePlan(p);need(p.stub||typeof inputs==='string','INPUTS_REQUIRED');
 const P=require('../lib/placebo'),H=require('./skill-handoff');
 for(const row of p.roster){const skill=inputSkill(p,row,inputs),fake=P.placeboFor({skillText:skill.skillMd,seed:skill.contentHash});
  P.assertPlaceboLength(skill.skillMd,fake);need(!P.sharedRun(skill.skillMd,fake.text),'PLACEBO_OVERLAP');
  if(!p.stub){need(H.handsOffOnly(skill.skillMd)===row.handoff,'HANDOFF_BINDING');
   require('../lib/run').assertSubjectFits({skill,cases:skill.suite.cases,modelId:p.model,trusted:false,capture:'text'});}
 }
 if(!p.stub){const a=require('../specs/408-skill-measurements/eval-audit.cjs').auditEvalUser();require('../specs/408-skill-measurements/campaign.cjs').auditValid(a);need(a.settings_sha256===p.contract.settings_hash,'SETTINGS_BINDING');need(require('../specs/783-fable-5-2-scope/price.cjs').cliVersion()===p.contract.cli_version,'CLI_BINDING');}
 return true;
}
function usageCost(plan,model,usage){const p=plan.prices[model];need(p&&Number.isFinite(usage?.input_tokens)&&usage.input_tokens>=0&&Number.isFinite(usage?.output_tokens)&&usage.output_tokens>=0,'USAGE_UNKNOWN');return number((2*usage.input_tokens*p.input+usage.output_tokens*p.output)/1e6);}
function reservationFor(plan,request){const p=plan.prices[request.model];need(p,'MODEL_BINDING');
 // Count the actual prompt bytes conservatively, then allow 4096 output tokens.
 // This is an estimate, not a promise about the subscription CLI's token output.
 return number((2*(Buffer.byteLength(request.system||'')+Buffer.byteLength(request.prompt||'')+3000)*p.input+4096*p.output)/1e6);
}
function stateOf(dir){const f=path.join(dir,'state.json');if(!fs.existsSync(f))return {format:'release-day-state/1',jobs:{}};const s=read(f);need(s.state_hash===hashDocument(s,'state_hash'),'STATE_BINDING');return s;}
function journals(dir,state=stateOf(dir)){
 return Object.values(state.jobs).map(x=>{need(/^[0-9a-f]{64}\.calls\.json$/.test(x.file),'JOURNAL_BINDING');const d=read(path.join(dir,x.file));need(d.journal_hash===hashDocument(d,'journal_hash'),'JOURNAL_BINDING');return d;});
}
function totalsOf(dir,allowed=null){const docs=journals(dir).filter(d=>!allowed||allowed.has(d.plan_hash));return {reserved:number(docs.reduce((s,d)=>s+d.calls.reduce((n,c)=>n+c.reserved_usd,0),0)),observed:number(docs.reduce((s,d)=>s+d.calls.reduce((n,c)=>n+(c.observed_usd||0),0),0)),uncertain:docs.some(d=>d.calls.some(c=>!c.reply)),calls:docs.reduce((s,d)=>s+d.calls.length,0)};}
function callJournal({dir,plan,job,transport,stub,cap=plan.cap_usd,reservation=null}){
 need(stub===plan.stub,'MODE_BINDING');fs.mkdirSync(dir,{recursive:true});
 const name=sha256(job.id)+'.calls.json',file=path.join(dir,name);
 let doc=fs.existsSync(file)?read(file):{plan_hash:plan.plan_hash,job_id:job.id,calls:[]};
 if(doc.journal_hash)need(doc.journal_hash===hashDocument(doc,'journal_hash')&&doc.plan_hash===plan.plan_hash&&doc.job_id===job.id,'JOURNAL_BINDING');
 let cursor=0,queue=Promise.resolve(),stopped=null,accountedAt=Date.now();
 const totals=totalsOf(dir);let registered=!!stateOf(dir).jobs[job.id];
 const save=()=>{doc=sealed(doc,'journal_hash');write(file,doc);if(!registered){const state=stateOf(dir);state.jobs[job.id]={file:name,plan_hash:plan.plan_hash};write(path.join(dir,'state.json'),sealed(state,'state_hash'));registered=true;}};
 const call=async request=>{
  if(stopped)throw stopped;
  const key=sha256(canonicalize(Object.fromEntries(Object.entries(request).filter(([,v])=>v!==undefined&&typeof v!=='function'))));
  const index=cursor++,old=doc.calls[index];
  if(old){need(old.request_hash===key,'REPLAY_MISMATCH');need(old.reply,'COST_UNCERTAIN');return structuredClone(old.reply);}
  need(!totals.uncertain,'COST_UNCERTAIN');
  const reserve=reservation??reservationFor(plan,request);
  need(totals.reserved+reserve<=cap+1e-9&&totals.observed+reserve<=cap+1e-9,'CAP_BEFORE_CALL');
  need(doc.calls.length<jobCallLimit(plan.contract),'CALL_CAP');
  const entry={request_hash:key,model:request.model,reserved_usd:reserve,started_at:new Date().toISOString(),reply:null};doc.calls.push(entry);totals.reserved=number(totals.reserved+reserve);save();
  let reply;try{reply=await transport({...request,onAttempt:n=>{need(n===1,'NO_AUTOMATIC_RETRY');request.onAttempt?.(n);}});}catch{fail('COST_UNCERTAIN');}
  need(reply.attempts===1,'CALL_COUNT');
  if(stub)need(reply.answeredBy==='stub'&&reply.surface==='stub','STUB_BINDING');
  else {need(reply.surface==='claude-cli'&&reply.isolation==='eval-user','SUBSCRIPTION_ONLY');const a=require('../lib/run').attest(reply,request.model,'release-day');need(a.attested,'MODEL_ATTESTATION');}
  entry.elapsed_ms=Math.max(1,Date.now()-accountedAt);accountedAt=Date.now();entry.observed_usd=usageCost(plan,request.model,reply.usage);entry.reply=reply;totals.observed=number(totals.observed+entry.observed_usd);save();
  return structuredClone(reply);
 };
 return {call:request=>{const result=queue.then(()=>call(request)).catch(e=>{e.refusal=e.code||'CALL_FAILED';e.code='BUDGET_HARDSTOP';stopped=e;throw e;});queue=result.catch(()=>{});return result;},document:()=>doc,consumed:()=>cursor};
}
function planName(version){return 'plan-'+String(version).padStart(3,'0')+'.json';}
function reportName(version){return 'report-'+String(version).padStart(3,'0')+'.json';}
function plansOf(dir){return fs.readdirSync(dir).filter(n=>/^plan-\d{3}\.json$/.test(n)).sort().map(n=>validatePlan(read(path.join(dir,n))));}
function receiptFile(job){return 'receipts/'+job.id+'.json';}
function verifyReceipt(p,job,r,journal,answers){
 const {verifyReceiptHash,validateReceipt}=require('../lib/receipt');
 need(journal&&journal.journal_hash===hashDocument(journal,'journal_hash'),'RECEIPT_JOURNAL');
 need(verifyReceiptHash(r)&&validateReceipt(r).valid,'RECEIPT_INVALID');
 const row=p.roster[job.rank-1],meta=r.results.cases[0]?.generation?.release_day;
 need(meta&&meta.plan_hash===p.plan_hash&&meta.contract_hash===p.contract_hash&&meta.job_id===job.id&&meta.journal_hash===journal.journal_hash,'RECEIPT_PROVENANCE');
 need(meta.skill_bytes_hash===(p.stub?sha256(stubText(row)):row.protocol.skill_sha256),'RECEIPT_SUBJECT');
 need(meta.calls===journal.calls.length&&journal.calls.every(c=>c.reply),'RECEIPT_CALLS');
 need(r.skill.name===row.protocol.skill&&r.suite.suite_hash===row.protocol.suite_hash&&r.run.model_id===job.model,'RECEIPT_IDENTITY');
 const expectedText=p.stub?Buffer.from(stubText(row)):null;
 need(r.skill.content_hash===sha256('SKILL.md\0'+(expectedText?sha256(expectedText):row.protocol.skill_sha256)+'\n'),'RECEIPT_SUBJECT');
 need(r.run.judge.model_id===p.contract.judge&&r.run.judge.samples===p.contract.samples&&r.run.judge.code_revision===p.contract.judge_code&&r.run.judge.prompt_template_hash===p.contract.prompt_hash,'RECEIPT_GRADER');
 if(r.run.judge.criteria_template_hash)need(r.run.judge.criteria_template_hash===p.contract.criteria_hash,'RECEIPT_GRADER');
 for(const k of ['temperature','sampling'])need(r.run.judge[k]===p.contract.judge_settings[k],'RECEIPT_GRADER');
 need(r.run.runner_version===p.contract.runner_version&&r.run.capture?.mode==='text','RECEIPT_RUNNER');
 need(p.stub?r.verification_level==='UNVERIFIED'&&r.run.surface==='stub'&&r.run.judge.surface==='stub'&&r.run.answered_by.kind==='stub':r.verification_level==='TESTED'&&r.run.surface==='claude-cli'&&r.run.judge.surface==='claude-cli'&&r.run.answered_by.attested&&r.run.answered_by.isolation==='eval-user'&&r.run.harness?.version===p.contract.cli_version&&r.run.judge.harness?.version===p.contract.cli_version,'RECEIPT_ELIGIBILITY');
 const suite=require('../lib/skill').suiteIdentity(read(path.join(ROOT,'specs/408-skill-measurements',row.suite)));
 need(same(r.results.cases.map(c=>c.id+'/'+c.mode),suite.cases.flatMap(c=>p.contract.arms.map(m=>c.id+'/'+m))),'RECEIPT_ARMS');
 const {placeboProblems}=require('../lib/verdict');need(r.placebo&&placeboProblems(r).length===0&&r.placebo.corpus_hash===p.contract.placebo.corpus_hash,'RECEIPT_PLACEBO');
 need(answers&&sha256(canonicalize(answers))===meta.answers_hash,'RECEIPT_ANSWERS');
 let calls=0;
 const draws=r.results.cases.flatMap(c=>c.generation.draws.map(d=>({c,d})));need(answers.length===draws.length,'RECEIPT_ANSWERS');
 for(const [i,{c,d}] of draws.entries()){
  need(same(c.generation.release_day,meta),'RECEIPT_PROVENANCE');
  const task=suite.cases.find(x=>x.id===c.id);if(c.judge)need(c.judge.model_id===p.contract.judge&&c.judge.rubric_hash===require('../lib/judge').caseRubricHash(task),'RECEIPT_RUBRIC');
  const a=answers[i];need(a.id===c.id&&a.mode===c.mode&&a.draw_index===d.draw_index&&sha256(a.answer)===d.generation_hash,'RECEIPT_ANSWERS');
  need(same(a.judge_outputs.map(sha256),d.judge_sample_hashes||[]),'RECEIPT_ANSWERS');
  calls+=1+(d.judge_sample_hashes||[]).length+(d.judge_parse_retries||[]).reduce((n,x)=>n+Math.max(0,x.attempts.length-1),0);
 }
 need(calls===journal.calls.length,'RECEIPT_CALLS');
 const savedReplies=new Map();for(const call of journal.calls){need(call.reply&&call.model&&p.prices[call.model]&&call.reserved_usd>0&&call.elapsed_ms>0&&call.observed_usd===usageCost(p,call.model,call.reply.usage),'RECEIPT_JOURNAL');need(p.stub?call.reply.answeredBy==='stub'&&call.reply.surface==='stub':call.reply.surface==='claude-cli'&&call.reply.isolation==='eval-user'&&require('../lib/run').attest(call.reply,call.model,'release-day').attested,'RECEIPT_ELIGIBILITY');const key=call.model+'/'+sha256(call.reply.text);savedReplies.set(key,(savedReplies.get(key)||0)+1);}
 const consume=(model,hash)=>{const key=model+'/'+hash;need(savedReplies.get(key)>0,'RECEIPT_CALL_EVIDENCE');savedReplies.set(key,savedReplies.get(key)-1);};
 for(const {d}of draws){consume(job.model,d.generation_hash);for(const hash of d.judge_sample_hashes||[])consume(p.contract.judge,hash);for(const retry of d.judge_parse_retries||[])for(const a of retry.attempts.slice(0,-1))consume(p.contract.judge,a.output_sha256);}
 need([...savedReplies.values()].every(n=>n===0),'RECEIPT_CALL_EVIDENCE');
 verifyScores(r,answers);
 return r;
}
// Reconstruct recorded scores from retained output, then aggregates from the draws.
// The frozen suites have scalar rubrics, not criteria. This reader never makes a call.
function verifyScores(r,answers){
 const {scoreOf}=require('../lib/judge'),{extractJsonObject}=require('../lib/json');
 const {mean,stddev,round}=require('../lib/stats'),sampling=require('../lib/sampling');
 let index=0;
 const equal=(a,b)=>need(same(a,b),'SCORE_RECONSTRUCTION');
 for(const c of r.results.cases){
  const g=c.generation;
  for(const d of g.draws){const a=answers[index++];
   if(d.status==='measured'){
    let scores;try{scores=a.judge_outputs.map(t=>scoreOf(extractJsonObject(t)));}catch{fail('SCORE_RECONSTRUCTION');}
    need(scores.length===r.run.judge.samples&&scores.every(n=>Number.isFinite(n)),'SCORE_RECONSTRUCTION');
    equal(d.samples,scores);equal(d.mean,round(mean(scores)));equal(d.stddev,round(stddev(scores)));
   }else need(d.mean==null&&(!d.samples||d.samples.length===0),'SCORE_RECONSTRUCTION');
  }
  const aggregate=sampling.acrossDraws(g.draws);
  for(const [k,value]of Object.entries(aggregate))equal(g[k],value);
  equal(g.n_planned,sampling.SAMPLING.min);equal(g.n_truncated,g.draws.filter(d=>d.truncated).length);
  const stop=sampling.nextAction(g.draws);need(stop.stop,'SCORE_RECONSTRUCTION');equal(g.stopping_reason,stop.reason);
  for(let i=1;i<g.draws.length;i++)need(!sampling.nextAction(g.draws.slice(0,i)).stop,'SCORE_RECONSTRUCTION');
  const last=g.draws.findLast(d=>d.status==='measured');
  if(last){equal(c.mean,aggregate.mean);equal(c.score,aggregate.mean);equal(c.stddev,aggregate.sd);equal(c.outcome,require('../lib/run').outcomeFor(aggregate.mean,aggregate.sd,c.threshold));for(const k of ['samples','generation_hash','judge_sample_hashes'])equal(c[k],last[k]);}
 }
 const expected=require('../lib/receipt').comparisonOf(r.results.cases);equal(r.results.aggregates,expected.aggregates);equal(r.comparison,expected.comparison);
}
function poolingIdentity(r){
 const j={...r.run.judge};delete j.parse_retries;delete j.parse_recoveries;delete j.parse_retry_cost_usd;
 return {skill:r.skill,suite:r.suite,model:r.run.model_id,judge:j,runner:r.run.runner_version,harness:r.run.harness||null,capture:r.run.capture,placebo:Object.fromEntries(Object.entries(r.placebo).filter(([k])=>!['aggregates','comparison'].includes(k))),rows:r.results.cases.map(c=>({id:c.id,mode:c.mode,judge:c.judge}))};
}
function pool(receipts){
 need(receipts.length>0,'POOL_EMPTY');const seen=new Set(),identity=poolingIdentity(receipts[0]);
 for(const r of receipts){need(require('../lib/receipt').verifyReceiptHash(r)&&require('../lib/receipt').validateReceipt(r).valid,'POOL_RECEIPT');need(!seen.has(r.receipt_hash),'POOL_DUPLICATE');seen.add(r.receipt_hash);need(same(poolingIdentity(r),identity),'POOL_GRADER_OR_SOURCE');}
 const r=structuredClone(receipts[0]);delete r.receipt_hash;
 if(receipts.some(x=>require('../lib/verdict').receiptVerdict(x).verdict==='NOT_MEASURED'))r.verification_level='UNVERIFIED';
 if(receipts.length>1){for(const [i,c]of r.results.cases.entries()){
   const draws=receipts.flatMap(x=>x.results.cases[i].generation.draws).map((d,index)=>({...d,draw_index:index}));
   c.generation={...c.generation,...require('../lib/sampling').acrossDraws(draws),n_planned:receipts.reduce((n,x)=>n+x.results.cases[i].generation.n_planned,0),n_truncated:draws.filter(d=>d.truncated).length,draws};
   c.case_status=draws.some(d=>d.status==='measured')?'ok':'failed_unmeasured';
  }
  const calc=require('../lib/receipt').comparisonOf(r.results.cases);r.results.aggregates=calc.aggregates;r.comparison=calc.comparison;
  const v=require('../lib/verdict'),pair=v.placeboPairing(r),fig=v.placeboFigures(r,pair.ids);
  r.placebo.aggregates={...fig.aggregates,...(pair.excluded.length?{excluded_cases:pair.excluded.map(e=>({id:e.id,modes:['placebo'],reason:e.reason}))}:{})};r.placebo.comparison=fig.comparison;
  if(r.results.fake_tool_calls)r.results.fake_tool_calls=require('../lib/text-capture').fakeToolCallCounts(r);
 }
 // This transient view feeds the existing readers. It is never sealed or published as a receipt.
 return r;
}
function readReport(dir,{version=null}={}){
 dir=outputDirectory(dir);if(fs.existsSync(path.join(dir,'receipts')))need(!fs.lstatSync(path.join(dir,'receipts')).isSymbolicLink(),'OUTPUT_DIRECTORY');const plans=plansOf(dir).filter(p=>version===null||p.version<=version);need(plans.length>0,'PLAN_MISSING');const p=plans.at(-1);
 if(p.version>1){const previous=readReport(dir,{version:p.version-1}).report;need(previous.report_hash===p.previous.report_hash&&same(read(path.join(dir,reportName(p.version-1))),previous),'PRIOR_REPORT_BINDING');}
 const state=stateOf(dir),rows=[];const docs=journals(dir,state),byId=new Map(docs.map(d=>[d.job_id,d]));
 for(const [i,plan]of plans.entries()){
  need(plan.version===i+1,'PLAN_CHAIN');
  if(i)need(plan.previous.plan_hash===plans[i-1].plan_hash,'PLAN_CHAIN');
 }
 for(const model of p.models)for(const row of p.roster){
  const sources=[],receipts=[];
  for(const plan of plans)for(const job of plan.jobs.filter(j=>j.rank===row.rank&&j.model===model)){
   const file=receiptFile(job);need(fs.existsSync(path.join(dir,file)),'REPORT_INCOMPLETE');
   const journal=byId.get(job.id);need(journal&&journal.plan_hash===plan.plan_hash,'JOURNAL_BINDING');
   const r=verifyReceipt(plan,job,read(path.join(dir,file)),journal,read(path.join(dir,'receipts',job.id+'-answers.json')));
   receipts.push(r);sources.push({file,answers_file:'receipts/'+job.id+'-answers.json',receipt_hash:r.receipt_hash,job_id:job.id,plan_hash:plan.plan_hash,calls:journal.calls.length});
  }
  need(receipts.length,'REPORT_INCOMPLETE');
  const view=pool(receipts),reading=require('../lib/verdict').placeboReading(view),normal=require('../lib/verdict').receiptVerdict(view);
  rows.push({rank:row.rank,skill:row.protocol.skill,model,router:row.router,handoff:row.handoff,sources,reading:reading.reading,line:require('../lib/verdict').placeboLine(reading),verdict:normal.verdict,
   secondary:require('../specs/613-placebo-skills-report/tally.cjs').secondaryReading(view).reading,
   draws:view.results.cases.map(c=>({id:c.id,mode:c.mode,n_drawn:c.generation.n_drawn,n_measured:c.generation.n_measured})),draws_needed:reading.drawsNeeded});
 }
 const firstDocs=docs.filter(d=>d.plan_hash===plans[0].plan_hash),firstCalls=firstDocs.flatMap(d=>d.calls);
 const first_rate={calls:firstCalls.length,elapsed_ms:firstCalls.reduce((n,c)=>n+c.elapsed_ms,0),evidence:p.stub?'simulated':'observed'};
 const tallies=p.models.map(model=>{const rs=rows.filter(r=>r.model===model&&!r.router),count=t=>rs.filter(r=>r.reading===t).length;return {model,N:rs.length,A:count('ABOVE_PLACEBO'),B:count('BELOW_PLACEBO'),U:count('UNDERPOWERED'),I:count('INCONCLUSIVE'),D:count('NO_DIFFERENCE'),M:count('NOT_MEASURED')};});
 const report=sealed({format:'driftproof-release-day-report/1',version:p.version,plan_hash:p.plan_hash,plan_file:planName(p.version),previous:p.previous,verification_level:p.stub?'UNVERIFIED':'TESTED',first_rate,tallies,rows,
  accounting:{calls:rows.reduce((n,r)=>n+r.sources.reduce((s,x)=>s+x.calls,0),0),...totalsOf(dir,new Set(plans.map(x=>x.plan_hash)))},limitations:LIMITS},'report_hash');
 return {plan:p,plans,report};
}
const LIMITS=[
 'These are three text tasks drafted by Driftproof from each skill. They do not test tool use or the work of a delegated skill.',
 'The four routing skills are shown but left out of the headline count. The two hand-off skills remain in the count; their tasks reflect the hand-off text, not the skill it calls.',
 'The placebo is same-length text chosen without reference to a task. It is not known to be inert and can score below no skill.',
 'A skill that did not score above the placebo is not shown to do no better than it. Cannot tell includes readings needing more draws or more cases.',
 'Deepened results pool all batches and are exploratory. Selection used earlier results; time between runs may affect answers. More draws may leave the result unresolved.',
 'Models are shown separately. No reading is a claim that one model is better than another. No effort override is sent; the CLI default applies.',
 'A receipt hash checks consistent bytes. It authenticates no author and proves no model execution.'
];
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const words={ABOVE_PLACEBO:'Scored above the placebo',BELOW_PLACEBO:'Scored below the placebo',UNDERPOWERED:'Cannot tell',INCONCLUSIVE:'Cannot tell',NO_DIFFERENCE:'No difference detected',NOT_MEASURED:'Not measured'};
function plainVerdict(token){return ({PASSED:'scored higher on at least one task and lower on none',REGRESSED:'scored lower on at least one task',NO_EFFECT:'no difference detected',PLACEBO_ABOVE_BASELINE:'scored higher on at least one task and lower on none',PLACEBO_BELOW_BASELINE:'scored lower on at least one task',...words})[token]||'not measured';}
function render(report){
 return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Twenty skills against a same-length placebo</title></head><body><main><h1>Twenty skills against a same-length placebo</h1>'+ 
  (report.verification_level==='UNVERIFIED'?'<p>Simulation only. No model was called. These results are not measurements.</p>':'<p>A release-day report on three text tasks per skill.</p>')+
  '<p>Version '+report.version+'. <a href="'+reportName(report.version)+'">Report data and evidence</a></p><ul>'+LIMITS.map(s=>'<li>'+esc(s)+'</li>').join('')+'</ul>'+
  report.tallies.map(t=>report.verification_level==='UNVERIFIED'?'<section><h2>'+esc(t.model)+'</h2><p>Simulation only: all '+t.N+' counted skills are not measured.</p></section>':'<section><h2>'+esc(t.model)+'</h2><p>'+t.A+' of '+t.N+' scored above the placebo on at least one task and below it on none. '+(t.U+t.I)+' cannot tell. '+t.M+' not measured.</p></section>').join('')+
  report.rows.map(r=>'<section><h2>'+esc(r.skill)+' on '+esc(r.model)+'</h2><p>'+words[r.reading]+'. '+esc(r.line)+'</p><p>Against no skill: '+esc(plainVerdict(r.verdict))+'. Placebo against no skill: '+esc(plainVerdict(r.secondary))+'.</p>'+ (r.router?'<p>Routing skill: left out of the headline count.</p>':'')+(r.handoff?'<p>Hand-off text: these tasks do not test the skill it calls.</p>':'')+'<ul>'+r.draws.map(d=>'<li>'+esc(d.id)+' / '+esc(d.mode)+': '+d.n_measured+' measured of '+d.n_drawn+' draws.</li>').join('')+'</ul><ul>'+r.sources.map(s=>'<li><a href="'+s.file+'">Sealed receipt</a>: <code>'+s.receipt_hash+'</code></li>').join('')+'</ul></section>').join('')+
  '<p>API-equivalent observed usage: USD '+report.accounting.observed+'. Estimated admissions: USD '+report.accounting.reserved+'. Subscription usage is not API billing. Prices may be estimates.</p></main></body></html>\n';
}
function draft(dir,checking=false){
 const {report}=readReport(dir),outputs={[reportName(report.version)]:JSON.stringify(report,null,2)+'\n',['report-'+String(report.version).padStart(3,'0')+'.html']:render(report),'index.html':render(report)};
 for(const [name,bytes]of Object.entries(outputs)){
  const file=path.join(dir,name);
  if(checking)need(fs.existsSync(file)&&regular(file).toString()===bytes,'DRAFT_STALE');
  else {if(name!=='index.html'&&fs.existsSync(file))need(regular(file).toString()===bytes,'VERSION_IMMUTABLE');else require('../lib/checkpoint').atomicFile(file,bytes);}
 }
 return report;
}
function runJob({plan:p,job,skill,journal}){
 return require('../lib/run').runSkillOnModel({skill,model:job.model,opts:{placebo:true,judgeModel:p.contract.judge,samples:p.contract.samples,concurrency:1,trusted:false,capture:'text',keepTranscripts:true,maxCalls:jobCallLimit(p.contract),nowIso:journal.document().calls[0]?.started_at||new Date().toISOString()}});
}
async function worker(dir,hash,inputs){
 // Internal entry is subject to the same approval, mode, source and surface checks.
 surfaceGate();dir=outputDirectory(dir);const p=plansOf(dir).find(p=>p.plan_hash===hash);need(p&&p.plan_hash===plansOf(dir).at(-1).plan_hash,'APPROVAL_HASH');approval(p,hash);need(same(read(path.join(dir,'registry-'+p.plan_hash+'.json')),p.registry),'REGISTRY_BINDING');need(p.stub===(process.env.DRIFTPROOF_STUB==='1'),'MODE_BINDING');
 process.env.DRIFTPROOF_REGISTRY=path.join(dir,'registry-'+p.plan_hash+'.json');
 // No consumer of complete may load before this wrapper is installed.
 const provider=require('../lib/provider'),original=provider.complete;let current=null;
 provider.complete=request=>{need(current,'CALL_OUTSIDE_JOB');return current.call(request);};
 require('../lib/run');const receipt=require('../lib/receipt');
 const lock=path.join(dir,'.execution.lock');let fd,evalFd;
 try{fd=fs.openSync(lock,'wx',0o600);}catch{fail('REPORT_ACTIVE');}
 const evalLock='/var/tmp/driftproof-issue613.lock';
 try{
 if(!p.stub){try{evalFd=fs.openSync(evalLock,'wx',0o600);}catch{fail('EVAL_ACTIVE');}}
 if(p.version>1){const prior=readReport(dir,{version:p.version-1});need(prior.report.report_hash===p.previous.report_hash,'PRIOR_REPORT_BINDING');
  const selected=prior.report.rows.filter(r=>['UNDERPOWERED','INCONCLUSIVE'].includes(r.reading)).map(r=>({rank:r.rank,model:r.model}));
  const added=p.models.filter(m=>!prior.plan.models.includes(m));need(added.length<=1&&prior.plan.models.every(m=>p.models.includes(m)),'MODEL_BINDING');
  for(const model of added)selected.push(...p.roster.map(r=>({rank:r.rank,model})));
  need(same(p.jobs.map(({rank,model})=>({rank,model})),selected),'SELECTION_BINDING');
 }
 preflight(p,inputs);fs.mkdirSync(path.join(dir,'receipts'),{recursive:true});need(!fs.lstatSync(path.join(dir,'receipts')).isSymbolicLink(),'OUTPUT_DIRECTORY');
 const audit=require('../specs/408-skill-measurements/eval-audit.cjs');
 for(const job of p.jobs){
  const file=path.join(dir,receiptFile(job));if(fs.existsSync(file)){
   const d=journals(dir).find(d=>d.job_id===job.id);verifyReceipt(p,job,read(file),d,read(path.join(dir,'receipts',job.id+'-answers.json')));continue;
  }
  const skill=inputSkill(p,p.roster[job.rank-1],inputs);
  current=callJournal({dir,plan:p,job,transport:original,stub:p.stub});
  const before=p.stub?null:audit.snapshotEvalUser(true);
  let result;
  try{result=await runJob({plan:p,job,skill,journal:current});}
  finally{if(!p.stub)audit.compareSnapshots(audit.snapshotEvalUser(true),before);}
  const doc=current.document();need(current.consumed()===doc.calls.length,'CALL_RECONCILIATION');
  const meta={plan_hash:p.plan_hash,contract_hash:p.contract_hash,job_id:job.id,journal_hash:doc.journal_hash,calls:doc.calls.length,answers_hash:sha256(canonicalize(result.answers)),skill_bytes_hash:sha256(skill.skillMd)};
  for(const c of result.receipt.results.cases)c.generation.release_day=meta;
  receipt.sealReceipt(result.receipt);verifyReceipt(p,job,result.receipt,doc,result.answers);
  write(path.join(dir,'receipts',job.id+'-answers.json'),result.answers);write(file,result.receipt);
 }
 draft(dir);console.log('release-day report: '+p.jobs.length+' jobs complete; version '+p.version+' drafted; '+(p.stub?'UNVERIFIED simulation':'sealed receipts checked'));
 }finally{if(evalFd!==undefined){fs.closeSync(evalFd);fs.unlinkSync(evalLock);}fs.closeSync(fd);fs.unlinkSync(lock);}
}
function printPlan(p){
 console.log('Twenty-skill report, version '+p.version+'. '+(p.stub?'Simulation only.':'Subscription CLI only.'));
 console.log(p.jobs.length+' skill runs; up to '+p.estimates.calls+' calls before parse retries; '+p.estimates.call_ceiling+' calls including up to '+p.estimates.retry_calls+' retries; API-equivalent estimate USD '+p.estimates.usd+' (USD '+p.estimates.usd_with_retries+' with every retry); ceiling USD '+p.cap_usd+'.');
 console.log(p.estimates.basis);
 for(const [id,price]of Object.entries(p.prices))console.log(id+': USD '+price.input+'/'+price.output+' per million input/output tokens'+(price.estimate?' (price estimate)':' (repository price)'));
 if(p.previous){console.log('Already reserved USD '+p.estimates.prior_reserved_usd+'; observed USD '+p.estimates.prior_observed_usd+'; cumulative ceiling USD '+p.cap_usd+'.');console.log('Adds 3 to 10 draws per task and arm for: '+p.jobs.map(j=>p.roster[j.rank-1].protocol.skill+' on '+j.model).join(', ')+'.');console.log('Expected wall-clock: '+(p.estimates.wall_seconds??0)+' seconds from first-run '+p.estimates.rate?.evidence+' call rate; '+p.estimates.wall_ceiling_seconds+' seconds with every parse retry. More draws may not resolve cannot tell.');}
 console.log('Plan hash: '+p.plan_hash);console.log('Stop: no calls made. After approval, repeat with --plan-hash '+p.plan_hash+'.');
}
async function main(args=process.argv.slice(2)){
 if(args[0]==='--worker'){need(args.length===4,'ARGUMENT');return worker(args[1],args[2],args[3]||null);}
 surfaceGate();if(!args.length){console.log('Plan a report: node scripts/release-day-report.js --model MODEL --inputs DIR --out DIR --cap USD');return;}const opts={};
 for(let i=0;i<args.length;i++){const k=args[i];need(['--model','--out','--inputs','--cap','--plan-hash','--deepen','--add-model','--check'].includes(k)&&!Object.hasOwn(opts,k),'ARGUMENT');if(['--deepen','--check'].includes(k))opts[k]=true;else{need(args[i+1]&&!args[i+1].startsWith('--'),'ARGUMENT');opts[k]=args[++i];}}
 const dir=outputDirectory(opts['--out']);
 if(opts['--check']){draft(dir,true);console.log('release-day draft: page and data current; all receipt seals checked');return;}
 const stub=process.env.DRIFTPROOF_STUB==='1',cap=Number(opts['--cap']);need(cap>0&&Number.isFinite(cap),'CAP_VALUE');
 fs.mkdirSync(dir,{recursive:true,mode:0o700});
 // One report lock and the existing eval-account lock cover planning, execution and rendering.
 const lock=path.join(dir,'.release-day.lock');let fd;try{fd=fs.openSync(lock,'wx',0o600);}catch{fail('REPORT_ACTIVE');}
 try{
  need(!fs.existsSync(path.join(dir,'.execution.lock')),'REPORT_ACTIVE');
  const existing=plansOf(dir);let p;
  if(opts['--plan-hash']){
   p=existing.find(p=>p.plan_hash===opts['--plan-hash']);need(p,'APPROVAL_HASH');need(p===existing.at(-1),'PLAN_HEAD');
   need(p.cap_usd===cap&&p.stub===stub&&(!opts['--model']||p.model===opts['--model']),'APPROVAL_OPTIONS');
  }else{
   let prior=null;
   if(opts['--deepen']){const pending=existing.at(-1);if(pending?.version>1&&!fs.existsSync(path.join(dir,reportName(pending.version)))){p=pending;need(p.cap_usd===cap&&p.stub===stub,'PLAN_EXISTS');}else{prior=readReport(dir);draft(dir,true);}} 
   else if(existing.length){p=existing[0];need(existing.length===1&&p.model===opts['--model']&&p.cap_usd===cap&&p.stub===stub,'PLAN_EXISTS');}
   if(!p)p=buildPlan({model:opts['--model'],cap,stub,prior,addModel:opts['--add-model']});
  }
  preflight(p,opts['--inputs']);
  const planFile=path.join(dir,planName(p.version));
  if(fs.existsSync(planFile))need(same(read(planFile),p),'PLAN_EXISTS');else write(planFile,p);
  const registryFile=path.join(dir,'registry-'+p.plan_hash+'.json');if(fs.existsSync(registryFile))need(same(read(registryFile),p.registry),'REGISTRY_BINDING');else write(registryFile,p.registry);
  if(!opts['--plan-hash']){printPlan(p);return;}
  approval(p,opts['--plan-hash']);
  const result=require('node:child_process').spawnSync(process.execPath,[__filename,'--worker',dir,p.plan_hash,opts['--inputs']||''],{env:process.env,encoding:'utf8',timeout:43200000,maxBuffer:4*1024*1024});
  need(!result.error,'WORKER_LAUNCH');
  if(result.stdout)process.stdout.write(result.stdout);if(result.stderr)process.stderr.write(result.stderr);need(result.status===0,'RUN_STOPPED');
 }finally{fs.closeSync(fd);fs.unlinkSync(lock);}
}
module.exports={ROOT,hashDocument,surfaceGate,outputDirectory,buildPlan,validatePlan,approval,preflight,inputSkill,callJournal,runJob,verifyReceipt,pool,readReport,draft,render,main};
if(require.main===module)main().catch(e=>{console.error(e.refusal||e.code||'RELEASE_DAY_FAILED');process.exitCode=1;});
