// SPDX-License-Identifier: Apache-2.0
'use strict';
// Issue 490: durable response replay preserves the existing serial sampling algorithm.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const {AsyncLocalStorage}=require('node:async_hooks');
const {canonicalize,sha256}=require('./canonical');
const {repositoryError:fail}=require('./repository');
const context=new AsyncLocalStorage();
const MAX=64*1024*1024;
const clone=x=>structuredClone(x);
const REQUIRED=['subject_hash','suite_hash','models','judges','capture_mode','starter_hash','samples','draws','timeout_ms',
  'runner_commit','source_hash','runtime_image_digest','effective_environment_hash','max_calls','concurrency','budget'];
function sealCheckpoint(doc) { const out=clone(doc);delete out.checkpoint_hash;out.checkpoint_hash=sha256(canonicalize(out));return out; }
function atomicFile(file,bytes) {
  if(Buffer.byteLength(bytes)>MAX)throw fail('CHECKPOINT_LIMIT','Checkpoint size limit.');
  const dir=path.dirname(file),temp=path.join(dir,'.publish-'+require('node:crypto').randomBytes(12).toString('hex'));
  const fd=fs.openSync(temp,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  try { fs.writeFileSync(fd,bytes);fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  try { fs.renameSync(temp,file);const d=fs.openSync(dir,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);try{fs.fsyncSync(d);}finally{fs.closeSync(d);} }
  finally { try{fs.unlinkSync(temp);}catch(e){if(e.code!=='ENOENT')throw e;} }
}
function writeCheckpoint(dir,doc) { atomicFile(path.join(dir,'checkpoint.json'),JSON.stringify(doc)+'\n'); }
function boundedJSON(file) {
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  let bytes;
  try {
    const st=fs.fstatSync(fd);
    if(!st.isFile()||st.size>MAX)throw fail('CHECKPOINT_LIMIT','Checkpoint must be a bounded regular file.');
    const buf=Buffer.alloc(st.size+1);let at=0,n;
    while((n=fs.readSync(fd,buf,at,buf.length-at,null))>0){at+=n;if(at>st.size)throw fail('CHECKPOINT_LIMIT','Checkpoint grew during read.');}
    bytes=buf.subarray(0,at).toString('utf8');
  } finally {fs.closeSync(fd);}
  let depth=0,inString=false,escape=false;
  for(const c of bytes) {
    if(inString){if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')inString=false;continue;}
    if(c==='"')inString=true;
    else if(c==='{'||c==='['){if(++depth>32)throw fail('CHECKPOINT_LIMIT','Checkpoint nesting limit.');}
    else if(c==='}'||c===']')depth--;
  }
  return JSON.parse(bytes);
}
function assertResumeCompatible(saved,requested) {
  for(const key of REQUIRED)if(!Object.hasOwn(saved,key)||!Object.hasOwn(requested,key)||canonicalize(saved[key])!==canonicalize(requested[key]))
    throw fail('RESUME_MISMATCH','Resume binding differs: '+key);
  if(canonicalize(saved)!==canonicalize(requested))throw fail('RESUME_MISMATCH','Resume binding differs.');
}
function readArtifact(dir,hash) {
  if(!/^[0-9a-f]{64}$/.test(hash))throw fail('CHECKPOINT_INVALID','Invalid artifact reference.');
  const value=boundedJSON(path.join(dir,'.artifact-'+hash+'.json'));
  if(sha256(canonicalize(value))!==hash)throw fail('CHECKPOINT_INVALID','Artifact hash differs.');
  return value;
}
function writeArtifact(dir,value) {
  const bytes=canonicalize(value),hash=sha256(bytes),file=path.join(dir,'.artifact-'+hash+'.json');
  if(fs.existsSync(file))readArtifact(dir,hash);else atomicFile(file,bytes+'\n');
  return hash;
}
function compactAnswer(dir,row) {
  if(typeof row.answer==='string')delete row.answer_ref;
  if(typeof row.answer==='string'&&Buffer.byteLength(row.answer)>8192){row.answer_ref=writeArtifact(dir,{answer:row.answer});delete row.answer;}
  return row;
}
function validate(doc,dir) {
  const began=Date.now();
  if(!doc||doc.version!==1||!Number.isSafeInteger(doc.revision)||doc.checkpoint_hash!==sealCheckpoint(doc).checkpoint_hash)
    throw fail('CHECKPOINT_INVALID','Checkpoint hash or version is invalid.');
  if(!doc.binding||REQUIRED.some(k=>!Object.hasOwn(doc.binding,k)))throw fail('CHECKPOINT_INVALID','Checkpoint binding is incomplete.');
  if(!Array.isArray(doc.draws)||doc.draws.length>20000||!Array.isArray(doc.attempts)||doc.attempts.length>100000)
    throw fail('CHECKPOINT_LIMIT','Checkpoint record limit.');
  if(!doc.scheduler||['decisions','next_key','pending_phase','sample_ordinal','rng_state'].some(k=>!Object.hasOwn(doc.scheduler,k)))
    throw fail('CHECKPOINT_INVALID','Checkpoint scheduler is incomplete.');
  const keys=new Set();
  for(const row of [...doc.draws,...doc.partial]) {
    const key=canonicalize(row.key);
    if(keys.has(key))throw fail('CHECKPOINT_INVALID','Duplicate draw key.');
    keys.add(key);
    if(row.answer_ref){const a=readArtifact(dir,row.answer_ref);if(typeof a.answer!=='string'||sha256(a.answer)!==row.answer_hash)throw fail('CHECKPOINT_INVALID','Answer artifact differs.');}
    if(typeof row.answer==='string'&&row.answer_hash!==sha256(row.answer))throw fail('CHECKPOINT_INVALID','Checkpoint answer hash mismatch.');
    if(!Object.hasOwn(row,'usage')||!Object.hasOwn(row,'delivery'))throw fail('CHECKPOINT_INVALID','Checkpoint usage or delivery absent.');
    if(row.judge_samples.some((s,i)=>sha256(s)!==row.judge_sample_hashes[i]))throw fail('CHECKPOINT_INVALID','Checkpoint judge sample hash mismatch.');
  }
  if(!Array.isArray(doc.partial)||doc.partial.length>1||Object.keys(doc.responses||{}).length>100000)throw fail('CHECKPOINT_LIMIT','Partial or response record limit.');
  for(const response of Object.values(doc.responses||{})){if(Date.now()-began>30000)throw fail('CHECKPOINT_LIMIT','Checkpoint validation time limit.');const reply=readArtifact(dir,response.reply_hash);if(!reply||typeof reply!=='object')throw fail('CHECKPOINT_INVALID','Saved response is invalid.');}
  if(!Array.isArray(doc.local_attempts||[])||(doc.local_attempts||[]).length>100000||Object.keys(doc.local_phases||{}).length>40000)throw fail('CHECKPOINT_LIMIT','Local phase record limit.');
  for(const row of [...Object.values(doc.local_phases||{}),...(doc.local_attempts||[]).filter(a=>a.result_hash)]){
    if(Date.now()-began>30000)throw fail('CHECKPOINT_LIMIT','Checkpoint validation time limit.');
    readArtifact(dir,row.result_hash);
  }
  return doc;
}
function readCheckpoint(dir,expectedBinding) {
  const doc=validate(boundedJSON(path.join(dir,'checkpoint.json')),dir);
  if(expectedBinding)assertResumeCompatible(doc.binding,expectedBinding);
  return doc;
}
function sourceIdentity() {
  const root=path.join(__dirname,'..');
  const files=['config.js','bin/driftproof',...fs.readdirSync(__dirname).filter(n=>n.endsWith('.js')).sort().map(n=>'lib/'+n)];
  const source_hash=sha256(files.map(f=>f+' '+sha256(fs.readFileSync(path.join(root,f)))).join('\n'));
  const r=cp.spawnSync('git',['-c','safe.directory='+root,'show','-s','--format=%H','HEAD'],{cwd:root,encoding:'utf8'});
  if(r.status!==0)throw fail('CHECKPOINT_SOURCE','Runner commit cannot be read.');
  return {runner_commit:r.stdout.trim(),source_hash};
}
function environment() {
  if(require('./stub').stubEnabled())return {runtime_image_digest:sha256(fs.readFileSync(process.execPath)),
    effective_environment_hash:sha256(canonicalize({node:process.version,platform:process.platform,arch:process.arch}))};
  return require('./repository-execution').environment();
}
function bindingFor({skill,model,opts}) {
  const capture=opts.capture||'text',modelId=require('./provider').resolveModel(model);
  const env=environment();
  return {...(opts.executionSuite?{execution_freeze:require('./execution-grading').validateExecutionSuite(opts.executionSuite,skill).freeze_hash}:{}),subject_hash:sha256(skill.skillMd),suite_hash:skill.suite.suiteHash,
    task_order:opts.taskIds||skill.suite.cases.slice(0,opts.maxCases||skill.suite.cases.length).map(c=>c.id),
    models:[modelId],judges:{[modelId]:require('./provider').resolveModel(opts.judgeModel||model)},
    capture_mode:capture,starter_hash:capture==='repository'?require('./repository').policy().starter_hash:null,
    samples:opts.samples||3,draws:{preset:opts.preset||null,count:opts.draws??null},
    timeout_ms:opts.timeoutMs??(capture==='repository'?900000:300000),case_timeouts:opts.caseTimeoutMs||{},
    ...sourceIdentity(),...env,concurrency:opts.concurrency??1,max_calls:opts.maxCalls||200,
    budget:opts.budget?{limit:opts.budget.capUsd}:null,
    only_arm:opts.onlyArm||null,placebo:!!opts.placebo,grader:require('./judge').JUDGE_CODE_REVISION};
}
function persist(c) {c.doc.revision++;c.doc=sealCheckpoint(c.doc);writeCheckpoint(c.dir,c.doc);}
function pauseRequested(c){return c.opts.pauseSignal?.aborted||fs.existsSync(path.join(c.dir,'pause'))||(c.opts.pauseFile&&fs.existsSync(c.opts.pauseFile));}
function stopped(code) {return ['CHECKPOINT_PAUSE','CLI_USAGE_LIMIT','CLI_EXIT','BUDGET_HARDSTOP','EXECUTION_HARNESS'].includes(code);}
function beginDraw(key) {
  const c=context.getStore();if(!c)return;
  c.key=key;c.sample=0;
  c.doc.scheduler.next_key=key;c.doc.scheduler.pending_phase='generation';c.doc.scheduler.sample_ordinal=0;
}
async function invokeCheckpoint(fn,request,phase) {
  const c=context.getStore();if(!c)return fn(request);
  const ordinal=phase==='judge'?c.sample++:0;
  const key=canonicalize([c.key,phase,ordinal]),requestHash=sha256(canonicalize(request));
  const cached=c.doc.responses[key];
  if(cached) {
    if(cached.request_hash!==requestHash)throw fail('RESUME_MISMATCH','Saved request differs from reconstructed request.');
    return readArtifact(c.dir,cached.reply_hash);
  }
  if(pauseRequested(c))throw fail('CHECKPOINT_PAUSE','Pause requested before dispatch.');
  if(Buffer.byteLength(JSON.stringify(c.doc))>MAX-16*1024*1024)throw fail('CHECKPOINT_CAPACITY','Checkpoint index reserve reached; no call dispatched.');
  if(c.doc.binding.budget&&c.doc.attempts.some(a=>a.usage===null))throw fail('BUDGET_UNCERTAIN','Unknown prior usage has no finite spend bound.');
  if(!require('./stub').stubEnabled()){const free=fs.statfsSync(c.dir);if(free.bavail*free.bsize<268435456)throw fail('CHECKPOINT_CAPACITY','Checkpoint publication needs 256 MiB free on its filesystem.');}
  if(c.doc.attempts.length>=c.doc.binding.max_calls)throw fail('BUDGET_HARDSTOP','Checkpoint call cap reached.');
  const attempt={id:c.doc.attempts.length,key:c.key,phase,sample_ordinal:ordinal,intent_at:new Date().toISOString(),state:'uncertain',usage:null};
  c.doc.attempts.push(attempt);
  let partial=c.doc.partial.find(r=>canonicalize(r.key)===canonicalize(c.key));
  if(!partial) {
    partial={key:c.key,answer:'',answer_hash:sha256(''),judge_samples:[],judge_sample_hashes:[],usage:{},delivery:null,status:'partial'};
    c.doc.partial.push(partial);
  }
  c.doc.scheduler.pending_phase=phase;c.doc.scheduler.sample_ordinal=ordinal;persist(c);
  try {
    const reply=await fn(request);
    const a=c.doc.attempts.find(a=>a.id===attempt.id);
    const confirmed=require('./stub').stubEnabled()||request.capture!=='repository'||reply.delivery?.init_seen===true;
    if(confirmed)a.launch_confirmed_at=new Date().toISOString();a.response_saved_at=new Date().toISOString();a.state=confirmed?'completed':'uncertain';a.usage=reply.usage&&Number.isFinite(reply.usage.input_tokens)&&Number.isFinite(reply.usage.output_tokens)?reply.usage:null;
    a.reported_cost_usd=Number.isFinite(reply.surfaceReportedCostUsd)&&reply.surfaceReportedCostUsd>=0?reply.surfaceReportedCostUsd:null;
    a.tool_errors=(reply.delivery?.tool_events||[]).filter(e=>e.type==='tool_result'&&e.is_error===true).length;
    a.stop_code=reply.stopCode||null;
    if(reply.stopCode)a.failure_detail=require('./repository-execution').redactRepositoryDiagnostics(reply.failureDetail||reply.text||reply.stopCode);
    if(!reply.stopCode)c.doc.responses[key]={request_hash:requestHash,reply_hash:writeArtifact(c.dir,reply)};
    partial=c.doc.partial.find(r=>canonicalize(r.key)===canonicalize(c.key));
    if(phase==='generation') {
      partial.answer=require('./capture').judgedAnswer(reply.text,request.capture==='repository'?reply.workspace:[],request.capture);
      partial.answer_hash=sha256(partial.answer);partial.delivery=reply.delivery??null;partial.usage.generation=reply.usage??null;
    } else {
      partial.judge_samples[ordinal]=reply.text;partial.judge_sample_hashes[ordinal]=sha256(reply.text);
      (partial.usage.judge||=[])[ordinal]=reply.usage??null;
    }
    compactAnswer(c.dir,partial);persist(c);if(reply.stopCode)throw fail(reply.stopCode,'CLI stopped; partial delivery evidence is durable.');
    c.opts.onProgress?.({phase:'response_saved',call_phase:phase,ordinal,key:c.key});
    return reply;
  } catch(e) {
    const a=c.doc.attempts.find(a=>a.id===attempt.id);
    if(!a.response_saved_at){a.stop_code=e.code||'CALL_ERROR';a.failure_detail=require('./repository-execution').redactRepositoryDiagnostics(e.message);a.reported_cost_usd=null;}
    persist(c);throw e;
  }
}
async function invokeLocalPhase(fn,request,phase) {
  if(!['snapshot','hidden-execution'].includes(phase))throw fail('CHECKPOINT_PHASE','Unknown local phase.');
  const c=context.getStore();if(!c)return fn(request);
  if(!c.key)throw fail('CHECKPOINT_PHASE','Local phase needs a draw key.');
  const key=canonicalize([c.key,phase]),requestHash=sha256(canonicalize(request));
  c.doc.local_phases ||= {};c.doc.local_attempts ||= [];
  const cached=c.doc.local_phases[key];
  if(cached){
    if(cached.request_hash!==requestHash)throw fail('RESUME_MISMATCH','Saved local request differs from reconstructed request.');
    return readArtifact(c.dir,cached.result_hash);
  }
  // A failed attempt is retained. Resume may retry it, but never with changed inputs.
  if(c.doc.local_attempts.some(a=>canonicalize([a.key,a.phase])===key&&a.request_hash!==requestHash))throw fail('RESUME_MISMATCH','Saved local request differs from reconstructed request.');
  if(pauseRequested(c))throw fail('CHECKPOINT_PAUSE','Pause requested before local phase.');
  if(c.doc.local_attempts.length>=100000||Buffer.byteLength(JSON.stringify(c.doc))>MAX-16*1024*1024)throw fail('CHECKPOINT_CAPACITY','Local phase publication reserve reached.');
  const id=c.doc.local_attempts.length;
  c.doc.local_attempts.push({id,key:c.key,phase,request_hash:requestHash,started_at:new Date().toISOString(),state:'uncertain'});
  c.doc.scheduler.pending_phase=phase;persist(c);
  try {
    const result=await fn(request),attempt=c.doc.local_attempts[id];
    attempt.result_hash=writeArtifact(c.dir,result);attempt.ended_at=new Date().toISOString();
    const unmeasured=result.status==='unmeasured';attempt.state=unmeasured?'failed':'completed';
    if(unmeasured)attempt.reason=require('./repository-execution').redactRepositoryDiagnostics(result.reason||'unmeasured execution');
    else c.doc.local_phases[key]={request_hash:requestHash,result_hash:attempt.result_hash};
    const partial=c.doc.partial.find(r=>canonicalize(r.key)===canonicalize(c.key));
    if(partial)(partial.phases ||= {})[phase]={status:attempt.state,result_hash:attempt.result_hash};
    persist(c);
    if(unmeasured)throw fail('EXECUTION_HARNESS','Hidden execution is unmeasured; evidence is durable.');
    c.opts.onProgress?.({phase:'local_phase_saved',call_phase:phase,key:c.key});
    return result;
  } catch(e) {
    const attempt=c.doc.local_attempts[id];
    if(attempt.state==='uncertain'){
      attempt.state='failed';attempt.ended_at=new Date().toISOString();attempt.reason=require('./repository-execution').redactRepositoryDiagnostics(e.message);
      attempt.code=require('./repository-execution').redactRepositoryDiagnostics(e.code||'LOCAL_PHASE_ERROR',64);persist(c);
    }
    if(e.code==='CHECKPOINT_PAUSE'||e.code==='RESUME_MISMATCH')throw e;
    throw fail('EXECUTION_HARNESS','Local '+phase+' failed; attempt evidence is durable.');
  }
}
function finishDraw(draw,kept) {
  const c=context.getStore();if(!c)return;
  if(c.doc.draws.some(r=>canonicalize(r.key)===canonicalize(c.key)))return;
  const partial=c.doc.partial.find(r=>canonicalize(r.key)===canonicalize(c.key));
  const row={...partial,key:c.key,answer:kept.answer??'',answer_hash:sha256(kept.answer??''),
    judge_samples:kept.judge_outputs,judge_sample_hashes:kept.judge_outputs.map(sha256),
    usage:partial?.usage||{},delivery:draw.delivery??partial?.delivery??null,status:draw.status};
  c.doc.partial=c.doc.partial.filter(r=>canonicalize(r.key)!==canonicalize(c.key));c.doc.draws.push(compactAnswer(c.dir,row));
  c.doc.scheduler.decisions.push({key:c.key,status:draw.status});c.doc.scheduler.pending_phase=null;c.doc.scheduler.sample_ordinal=null;
  persist(c);
  c.opts.onProgress?.({phase:'checkpoint',key:c.key});
  if(pauseRequested(c))throw fail('CHECKPOINT_PAUSE','Pause requested.');
}
function executionCounts(doc) {
  const confirmed=doc.attempts.filter(a=>a.launch_confirmed_at).length,uncertain=doc.attempts.filter(a=>!a.launch_confirmed_at).length;
  return {dispatch_intents:doc.attempts.length,confirmed_launches:confirmed,uncertain_attempts:uncertain,
    exact_launches:uncertain?null:confirmed,usage_complete:doc.attempts.every(a=>a.usage!==null),
    evidence_kind:require('./stub').stubEnabled()?'simulated':'observed'};
}
function attemptAccounting(doc) {
  const rows=doc.attempts;
  return {basis:'subscription-accounting',attempts:rows.length,
    reported_cost_usd:Math.round(rows.reduce((n,a)=>n+(a.reported_cost_usd??0),0)*1e9)/1e9,
    unknown_cost_attempts:rows.filter(a=>a.reported_cost_usd==null).length,
    interrupted_attempts:rows.filter(a=>a.stop_code).length,
    tool_errors:rows.reduce((n,a)=>n+(a.tool_errors||0),0),
    stops:rows.filter(a=>a.stop_code).map(a=>({attempt:a.id,phase:a.phase,code:a.stop_code,detail:a.failure_detail||''}))};
}
async function runWithCheckpoint(args,run) {
  const opts=args.opts||{};
  if(!opts.checkpointDir&&!opts.resume)return run(args);
  const dir=path.resolve(opts.resume||opts.checkpointDir);
  if(opts.resume&&opts.checkpointDir&&path.resolve(opts.checkpointDir)!==dir)throw fail('RESUME_MISMATCH','Output directory differs.');
  const binding=bindingFor({...args,opts});
  if(opts.capture==='repository'&&!require('./stub').stubEnabled()){const dirty=cp.spawnSync('git',['status','--porcelain','--untracked-files=no'],{cwd:path.join(__dirname,'..'),encoding:'utf8'});if(dirty.status!==0||dirty.stdout.trim())throw fail('CHECKPOINT_SOURCE','Commit the runner before a live repository run.');}
  let doc=null;
  if((opts.concurrency??1)!==1)throw fail(opts.resume?'RESUME_MISMATCH':'CHECKPOINT_CONCURRENCY','Checkpoint calls must be serial.');
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const release=await acquireLock(dir);
  const boot=fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim();
  try {
    if(opts.resume)doc=readCheckpoint(dir,binding);
    if(doc) {
      for(const s of doc.segments){if(s.scope?.boot_id!==boot)throw fail('RESUME_NOT_QUIESCENT','Previous segment boot differs.');
        if(s.scope.units?.length){for(const unit of s.scope.units)require('./repository-execution').assertQuiescent(unit);s.scope.quiescent=true;}
        if(!s.scope?.quiescent)throw fail('RESUME_NOT_QUIESCENT','Previous segment scope is not verified empty.');}
      if(opts.budget&&doc.attempts.some(a=>a.usage===null))throw fail('BUDGET_UNCERTAIN','Unknown prior usage has no finite spend bound.');
      if(['finalizing','completed'].includes(doc.status)) {
        const r=JSON.parse(doc.final_receipt_bytes);
        if(!require('./receipt').verifyReceiptHash(r)||r.receipt_hash!==doc.final_receipt_hash)throw fail('CHECKPOINT_INVALID','Final receipt hash differs.');
        const file=path.join(dir,doc.final_receipt_file);
        if(path.dirname(file)!==dir)throw fail('CHECKPOINT_INVALID','Unsafe receipt path.');
        if(fs.existsSync(file)&&fs.readFileSync(file,'utf8')!==doc.final_receipt_bytes)throw fail('CHECKPOINT_INVALID','Conflicting final receipt.');
        atomicFile(file,doc.final_receipt_bytes);doc.status='completed';doc.revision++;writeCheckpoint(dir,sealCheckpoint(doc));
        return {...readArtifact(dir,doc.final_result_ref),receipt:r};
      }
    } else {
      if(fs.existsSync(path.join(dir,'checkpoint.json')))throw fail('CHECKPOINT_EXISTS','Use resume for an existing checkpoint.');
      doc={version:1,revision:0,binding,draws:[],partial:[],responses:{},attempts:[],local_phases:{},local_attempts:[],segments:[],status:'running',
        scheduler:{decisions:[],next_key:null,pending_phase:null,sample_ordinal:null,rng_state:null}};
    }
    for(const segment of doc.segments)if(segment.end===null){segment.end=new Date().toISOString();segment.end_basis='quiescence_observed';segment.reason='owner_stopped';}
    const loaded=doc.draws.length;
    if(pauseRequested({opts,dir})){doc.status='paused';writeCheckpoint(dir,sealCheckpoint(doc));return {status:'paused',receipt:null,checkpoint:path.join(dir,'checkpoint.json')};}
    doc.segments.push({index:doc.segments.length,start:new Date().toISOString(),end:null,reason:null,
      scope:{boot_id:boot,quiescent:true,units:[]}});
    doc.status='running';const c={dir,doc,opts,key:null,sample:0};persist(c);
    return await context.run(c,async()=>{
      try {
        const result=await run(args);
        const last=c.doc.segments.at(-1);last.end=new Date().toISOString();last.reason='completed';
        const receipt=result.receipt;
        receipt.run.resume={resumed:!!opts.resume,checkpoint_draws:loaded,segments:clone(c.doc.segments)};
        receipt.run.execution=executionCounts(c.doc);
        if(c.doc.binding.execution_freeze)receipt.run.local_execution={attempts:clone(c.doc.local_attempts||[])};
        if(c.doc.binding.capture_mode==='repository')receipt.run.accounting=attemptAccounting(c.doc);
        receipt.run.checkpoint_evidence_hash=sha256(canonicalize({binding:c.doc.binding,draws:c.doc.draws,attempts:c.doc.attempts,local_phases:c.doc.local_phases||{},local_attempts:c.doc.local_attempts||[],segments:c.doc.segments}));
        const sealed=require('./receipt').sealReceipt(receipt);
        c.doc.final_receipt_bytes=JSON.stringify(sealed,null,2)+'\n';c.doc.final_receipt_hash=sealed.receipt_hash;
        c.doc.final_receipt_file='receipt-'+sealed.receipt_hash.slice(0,12)+'.json';
        const {receipt:_,...rest}=result;c.doc.final_result_ref=writeArtifact(c.dir,rest);c.doc.status='finalizing';persist(c);
        atomicFile(path.join(dir,c.doc.final_receipt_file),c.doc.final_receipt_bytes);
        c.doc.status='completed';persist(c);return {...result,receipt:sealed};
      } catch(e) {
        if(!stopped(e.code))throw e;
        const last=c.doc.segments.at(-1);last.end=new Date().toISOString();last.reason=e.code==='CHECKPOINT_PAUSE'?'paused':e.code==='CLI_USAGE_LIMIT'?'usage_limit':e.code==='BUDGET_HARDSTOP'?'call_cap':e.code==='EXECUTION_HARNESS'?'execution_harness':'cli_exit';
        c.doc.status='paused';persist(c);return {status:'paused',reason:last.reason,accounting:attemptAccounting(c.doc),receipt:null,checkpoint:path.join(dir,'checkpoint.json')};
      }
    });
  } finally {await release();}
}
async function acquireLock(dir) {
  const child=cp.spawn('/usr/bin/flock',['-n',path.join(dir,'.checkpoint-lock'),process.execPath,'-e',
    "process.stdout.write('locked\\n');process.stdin.resume();process.stdin.on('end',()=>process.exit(0));"],
    {env:{},stdio:['pipe','pipe','ignore']});
  const closed=new Promise(resolve=>child.once('close',resolve));
  await new Promise((resolve,reject)=>{
    child.once('error',reject);child.stdout.once('data',()=>resolve());
    child.once('close',()=>reject(fail('CHECKPOINT_BUSY','Output directory has another owner.')));
  });
  return async()=>{child.stdin.end();await closed;};
}
function scopeStarted(unit) {
  const c=context.getStore();if(!c)return;
  const scope=c.doc.segments.at(-1).scope;
  scope.units.push(unit);scope.quiescent=false;persist(c);
}
function scopeStopped(unit) {
  const c=context.getStore();if(!c)return;
  require('./repository-execution').assertQuiescent(unit);
  c.doc.segments.at(-1).scope.quiescent=true;persist(c);
}
module.exports={acquireLock,attemptAccounting,sourceIdentity,scopeStarted,scopeStopped,sealCheckpoint,writeCheckpoint,readCheckpoint,assertResumeCompatible,atomicFile,boundedJSON,runWithCheckpoint,invokeCheckpoint,invokeLocalPhase,beginDraw,finishDraw,executionCounts,context};
