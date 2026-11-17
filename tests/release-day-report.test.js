// SPDX-License-Identifier: Apache-2.0
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const R=require('../scripts/release-day-report');
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'release-day-816-'));
const stub={DRIFTPROOF_STUB:'1'};
const plan=()=>R.buildPlan({model:'claude-release-test',cap:1000,stub:true});
const save=(f,x)=>fs.writeFileSync(f,JSON.stringify(x));
test('AC-1/2: frozen twenty and full plan identity; tampered plan refuses',()=>{
 const p=plan(); assert.equal(p.roster.length,20);assert.equal(p.jobs.length,20);
 assert.equal(p.estimates.calls,10800);assert.equal(p.contract.samples,5);
 assert.equal(p.contract.judge_parse_retry_limit,1);assert.equal(p.estimates.call_ceiling,19800);assert.equal(p.estimates.retry_calls,9000);
 const judgePrice=p.prices[p.contract.judge];
 assert.equal(p.estimates.usd_with_retries,Math.round((p.estimates.usd+9000*(2600*judgePrice.input+200*judgePrice.output)/1e6)*1e6)/1e6);
 assert.equal(p.contract.judge,'claude-haiku-5-5');assert.equal(p.contract.capture,'text');
 assert.ok(p.contract.code['lib/judge.js']);assert.ok(p.contract.code['lib/provider.js']);
 assert.equal(p.roster.filter(x=>x.router).length,4);
 R.validatePlan(p);const changed=structuredClone(p);changed.model='claude-another';
 assert.throws(()=>R.validatePlan(changed),/PLAN/);
 const pin=structuredClone(p);pin.roster[0].protocol.skill_sha256='0'.repeat(64);
 pin.plan_hash=R.hashDocument(pin,'plan_hash');assert.throws(()=>R.validatePlan(pin),/ROSTER/);
 assert.throws(()=>R.approval(p,'0'.repeat(64)),/APPROVAL/);
 const retry=structuredClone(p);retry.contract.judge_parse_retry_limit=2;
 retry.contract_hash=require('../lib/canonical').sha256(require('../lib/canonical').canonicalize(retry.contract));retry.plan_hash=R.hashDocument(retry,'plan_hash');
 assert.throws(()=>R.validatePlan(retry),/RETRY_LIMIT_BINDING/);
});
test('AC-3: every Anthropic variable and provider override refuses, including empty values',()=>{
 R.surfaceGate(stub);
 for(const env of [{ANTHROPIC_EXAMPLE:''},{ANTHROPIC_API_KEY:'test-only'},{CLAUDE_PROVIDER:'api'},{DRIFTPROOF_REGISTRY:'other'},{DRIFTPROOF_MODEL_REGISTRY:'other'}])
 assert.throws(()=>R.surfaceGate(env),/SUBSCRIPTION/);
});
test('AC-9: output cannot resolve into the checkout, including symlinks',()=>{
 for(const d of [R.ROOT,path.join(R.ROOT,'receipts/report-019'),path.join(R.ROOT,'docs/new')])assert.throws(()=>R.outputDirectory(d),/OUTPUT/);
 const d=tmp();fs.symlinkSync(R.ROOT,path.join(d,'link'));assert.throws(()=>R.outputDirectory(path.join(d,'link/new')),/OUTPUT/);
 assert.equal(R.outputDirectory(path.join(d,'ok')),path.join(d,'ok'));
});
test('AC-4: before-call cap, durable replay, changed request and uncertain intent',async()=>{
 const dir=tmp();let calls=0;const request={model:'claude-release-test',system:'rules',prompt:'task'};
 const transport=async()=>{calls++;return {text:'answer',usage:{input_tokens:1,output_tokens:1},surface:'stub',answeredBy:'stub',attempts:1};};
 const options={dir,plan:plan(),job:{id:'test'},transport,stub:true};
 const j=R.callJournal({...options,cap:0.05,reservation:0.03});
 await j.call(request);await assert.rejects(j.call({...request,prompt:'next'}),/CAP/);assert.equal(calls,1);
 const again=R.callJournal({...options,cap:0.05,reservation:0.03});await again.call(request);assert.equal(calls,1);
 const moved=R.callJournal({...options,cap:0.05,reservation:0.03});await assert.rejects(moved.call({...request,prompt:'changed'}),/REPLAY/);
 const interruptedDir=tmp();let interruptedCalls=0;
 const uncertain=R.callJournal({...options,dir:interruptedDir,cap:1,reservation:0.03,transport:async()=>{interruptedCalls++;throw Error('interrupted');}});
 const costUncertain=e=>e.refusal==='COST_UNCERTAIN'&&e.code==='BUDGET_HARDSTOP';
 await assert.rejects(uncertain.call(request),costUncertain);assert.equal(interruptedCalls,1);
 // A new journal has no in-memory stopped error. Both paths must read the disk intent.
 for(const job of [options.job,{id:'another-job'}]){
  let resumedCalls=0;
  const resumed=R.callJournal({...options,dir:interruptedDir,job,cap:1,reservation:0.03,transport:async()=>{resumedCalls++;return transport();}});
  await assert.rejects(resumed.call(request),costUncertain);assert.equal(resumedCalls,0);
 }
 assert.equal(calls,1);
});
test('AC-4: maximum draws and every judge parse retry fit, then the call bound refuses',async()=>{
 const p=R.buildPlan({model:'claude-haiku-5-5',cap:1000,stub:true}),dir=tmp();
 const provider=require('../lib/provider'),original=provider.complete;
 const moduleIds=['../lib/judge','../lib/run'].map(require.resolve),cached=moduleIds.map(id=>require.cache[id]);
 const previousStub=process.env.DRIFTPROOF_STUB;
 let calls=0,generations=0,grades=0,journal;
 const scores=[0,1,0.2,0.9,0.1,0.8,0.3,1,0,0.7];
 const reply=text=>({text,attempts:1,usage:{input_tokens:1,output_tokens:1},surface:'stub',answeredBy:'stub'});
 const transport=async request=>{
  calls++;request.onAttempt?.(1);
  if(!/Return ONLY/.test(request.prompt)){generations++;return reply('A primary colour is red.');}
  grades++;return reply(grades%2?'{' : JSON.stringify({score:scores[(generations-1)%10],reason:'Canned grade.'}));
 };
 try{
  process.env.DRIFTPROOF_STUB='1';for(const id of moduleIds)delete require.cache[id];
  provider.complete=request=>journal.call(request);
  const skillDir=tmp();fs.mkdirSync(path.join(skillDir,'evals'));
  fs.writeFileSync(path.join(skillDir,'SKILL.md'),'---\nname: retry-boundary\n---\nAnswer the question.\n');
  save(path.join(skillDir,'evals/evals.json'),{cases:[1,2,3].map(n=>({id:'colour-'+n,prompt:'Name a primary colour.',rubric:'Names a colour.',pass_threshold:0.7}))});
  const skill=require('../lib/skill').loadSkill(skillDir),job=p.jobs[0];
  const options={dir,plan:p,job,transport,stub:true,reservation:0.001};
  journal=R.callJournal(options);
  const result=await R.runJob({plan:p,job,skill,journal});
  assert.equal(generations,90);assert.equal(grades,900);assert.equal(calls,990);
  assert.equal(result.calls,990);assert.equal(journal.document().calls.length,990);
  assert.ok(result.receipt.results.cases.every(c=>c.generation.n_drawn===10));
  assert.equal(result.receipt.run.judge.parse_retries,450);
  assert.equal(result.receipt.run.judge.parse_recoveries,450);
  await assert.rejects(journal.call({model:p.model,prompt:'beyond the bound'}),e=>e.refusal==='CALL_CAP');assert.equal(calls,990);
  journal=R.callJournal(options);await R.runJob({plan:p,job,skill,journal});assert.equal(calls,990);
  await assert.rejects(journal.call({model:p.model,prompt:'beyond the bound'}),e=>e.refusal==='CALL_CAP');assert.equal(calls,990);
  // Independently observe the pinned judge's retry limit even when both replies are malformed.
  let attempts=0;provider.complete=async()=>{attempts++;return reply('{');};delete require.cache[moduleIds[0]];
  const bad=await require('../lib/judge').gradeOnce({task:'Name a colour.',response:'Red.',rubric:'Names a colour.',model:p.model});
  assert.equal(bad.unmeasured,true);assert.equal(attempts,2);
  assert.equal(p.contract.judge_parse_retry_limit,attempts-1);
  assert.equal(p.estimates.call_ceiling,p.jobs.length*990);
  assert.equal(p.estimates.retry_calls,p.jobs.length*450);
 }finally{
  provider.complete=original;moduleIds.forEach((id,i)=>{if(cached[i])require.cache[id]=cached[i];else delete require.cache[id];});
  if(previousStub===undefined)delete process.env.DRIFTPROOF_STUB;else process.env.DRIFTPROOF_STUB=previousStub;
 }
});
test('AC-6/8: deepen selection and estimate use verified rows and the first observed rate',()=>{
 const p=plan();const prior={plan:p,report:{rows:p.roster.map((r,i)=>({rank:r.rank,model:p.model,reading:i<2?'UNDERPOWERED':i===2?'INCONCLUSIVE':'ABOVE_PLACEBO'})),first_rate:{calls:100,elapsed_ms:200000,evidence:'observed'},report_hash:'a'.repeat(64)},plans:[p]};
 const next=R.buildPlan({model:p.model,cap:1000,stub:true,prior});
 assert.equal(next.jobs.length,3);assert.equal(next.estimates.calls,1620);assert.equal(next.estimates.wall_seconds,3240);assert.equal(next.estimates.call_ceiling,2970);assert.equal(next.estimates.wall_ceiling_seconds,5940);
 const second=R.buildPlan({model:p.model,cap:1000,stub:true,prior,addModel:'claude-second-test'});assert.equal(second.jobs.length,23);
 const bad=structuredClone(prior);bad.report.first_rate=null;assert.throws(()=>R.buildPlan({model:p.model,cap:1000,stub:true,prior:bad}),/RATE/);
});
test('AC-1/7/8: stub command plans without calls, runs twenty, resumes, checks and refuses stale draft', {timeout:1800000},()=>{
 const {spawnSync}=require('node:child_process'),dir=tmp();
 const run=(args)=>spawnSync(process.execPath,[path.join(R.ROOT,'scripts/release-day-report.js'),...args],{env:{...process.env,DRIFTPROOF_STUB:'1',TMPDIR:os.tmpdir()},encoding:'utf8',timeout:1800000,maxBuffer:4*1024*1024});
 const args=['--model','claude-release-test','--out',dir,'--cap','1000'];
 const first=run(args);assert.ifError(first.error);assert.equal(first.status,0,first.stdout+first.stderr);assert.match(first.stdout,/no calls made/);
 assert.ok(!fs.existsSync(path.join(dir,'state.json')));
 const p=JSON.parse(fs.readFileSync(path.join(dir,'plan-001.json')));
 const exec=run([...args,'--plan-hash',p.plan_hash]);assert.equal(exec.status,0,exec.stdout+exec.stderr);
 const data=JSON.parse(fs.readFileSync(path.join(dir,'report-001.json')));
 assert.equal(data.rows.length,20);assert.ok(data.rows.every(r=>r.reading==='NOT_MEASURED'));
 assert.equal(data.verification_level,'UNVERIFIED');assert.equal(data.tallies[0].N,16);
 const before=fs.readFileSync(path.join(dir,'state.json'));
 const resume=run([...args,'--plan-hash',p.plan_hash]);assert.equal(resume.status,0,resume.stdout+resume.stderr);
 assert.deepEqual(fs.readFileSync(path.join(dir,'state.json')),before);
 assert.equal(run(['--out',dir,'--check']).status,0);
 const receiptPath=path.join(dir,data.rows[0].sources[0].file),originalBytes=fs.readFileSync(receiptPath);
 const r=JSON.parse(originalBytes),job=p.jobs.find(j=>j.id===data.rows[0].sources[0].job_id);
 const journal=JSON.parse(fs.readFileSync(path.join(dir,require('../lib/canonical').sha256(job.id)+'.calls.json')));
 const answers=JSON.parse(fs.readFileSync(path.join(dir,'receipts',job.id+'-answers.json')));
 for(const mutate of [x=>x.results.cases.pop(),x=>x.run.judge.temperature=0.5,x=>x.verification_level='TESTED',x=>x.results.cases[0].generation.draws[0].samples[0]=0.01]){
  const altered=structuredClone(r);mutate(altered);require('../lib/receipt').sealReceipt(altered);
  assert.throws(()=>R.verifyReceipt(p,job,altered,journal,answers),/RECEIPT_|SCORE_RECONSTRUCTION/);
 }
 const deepArgs=['--deepen','--add-model','claude-second-test','--out',dir,'--cap','1000'];
 const deep=run(deepArgs);assert.ifError(deep.error);assert.equal(deep.status,0,deep.stdout+deep.stderr);assert.match(deep.stdout,/Expected wall-clock/);assert.match(deep.stdout,/no calls made/);
 const next=JSON.parse(fs.readFileSync(path.join(dir,'plan-002.json')));assert.equal(next.jobs.length,20);
 const deepen=run([...deepArgs,'--plan-hash',next.plan_hash]);assert.ifError(deepen.error);assert.equal(deepen.status,0,deepen.stdout+deepen.stderr);
 assert.deepEqual(fs.readFileSync(receiptPath),originalBytes);
 assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'report-002.json'))).rows.length,40);
 assert.equal(run(['--out',dir,'--check']).status,0);
 const priorFile=path.join(dir,'report-001.json'),priorBytes=fs.readFileSync(priorFile),forged=JSON.parse(priorBytes);forged.tallies[0].A=16;save(priorFile,forged);
 assert.throws(()=>R.readReport(dir),/PRIOR_REPORT_BINDING/);fs.writeFileSync(priorFile,priorBytes);
 const html=path.join(dir,'index.html');fs.appendFileSync(html,'stale');assert.notEqual(run(['--out',dir,'--check']).status,0);
 const receiptFile=path.join(dir,data.rows[0].sources[0].file),receipt=JSON.parse(fs.readFileSync(receiptFile));receipt.skill.name='changed';save(receiptFile,receipt);
 assert.throws(()=>R.readReport(dir),/RECEIPT/);
});

test('AC-5/6/7: pool keeps every draw and rejects duplicate, model, rubric and grader plants',()=>{
 const dir=path.join(R.ROOT,'receipts/report-019/campaign-001');
 const name=fs.readdirSync(dir).sort().find(n=>/^[a-f0-9]{64}\.json$/.test(n));
 const r=JSON.parse(fs.readFileSync(path.join(dir,name)));
 const {sealReceipt}=require('../lib/receipt');
 const second=structuredClone(r);second.run.date_utc='2026-11-16T12:00:00.000Z';sealReceipt(second);
 const both=R.pool([r,second]);assert.equal(both.receipt_hash,undefined);
 both.results.cases.forEach((c,i)=>assert.equal(c.generation.n_drawn,r.results.cases[i].generation.n_drawn*2));
 assert.throws(()=>R.pool([r,r]),/DUPLICATE/);
 for(const mutate of [x=>x.run.model_id='claude-haiku-5-5',x=>x.run.judge.temperature=0.5,x=>x.run.judge.prompt_template_hash='0'.repeat(64),x=>x.results.cases[0].judge.rubric_hash='0'.repeat(64)]){
  const changed=structuredClone(second);mutate(changed);sealReceipt(changed);assert.throws(()=>R.pool([r,changed]),/POOL_/);
 }
 const bad=structuredClone(r);bad.skill.name='bad';assert.throws(()=>R.pool([bad]),/RECEIPT/);
 const simulated=structuredClone(r);simulated.verification_level='UNVERIFIED';simulated.run.surface='stub';simulated.run.answered_by.kind='stub';sealReceipt(simulated);
 assert.equal(require('../lib/verdict').placeboReading(R.pool([simulated])).reading,'NOT_MEASURED');
});
test('AC-1: a changed staged live skill refuses its frozen pin before any model call',()=>{
 const p=plan();p.stub=false;const dir=tmp();fs.writeFileSync(path.join(dir,p.roster[0].source_attempt+'.md'),'changed');
 assert.throws(()=>R.inputSkill(p,p.roster[0],dir),/SKILL_BYTES/);
});
test('AC-2: a rehashed plan with changed code still refuses the live bytes',()=>{
 const p=plan();p.contract.code['lib/judge.js']='0'.repeat(64);p.contract_hash=require('../lib/canonical').sha256(require('../lib/canonical').canonicalize(p.contract));p.plan_hash=R.hashDocument(p,'plan_hash');
 assert.throws(()=>R.validatePlan(p),/CODE_BINDING/);
});
