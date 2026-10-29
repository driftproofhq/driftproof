// SPDX-License-Identifier: Apache-2.0
'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const {canonicalize}=require('./canonical');
const R=require('./repository');
let stubRunner=null;
function setStubRunner(fn) {
  if(process.env.DRIFTPROOF_STUB!=='1')throw R.repositoryError('CAPTURE_ISOLATION','Test runner requires the explicit stub surface.');
  stubRunner=fn;
}
function assertRequest({surface,trusted=false}) {
  if(surface!=='claude-cli')throw R.repositoryError('CAPTURE_SURFACE','Repository capture requires claude-cli.');
  if(trusted)throw R.repositoryError('CAPTURE_ISOLATION','Repository capture requires isolated execution.');
}
function profileFile() {return process.env.DRIFTPROOF_REPOSITORY_PROFILE||'/var/tmp/bbuild/490/runtime-tool-env-v1/profile.json';}
function environment() {
  if(process.env.DRIFTPROOF_STUB==='1')return {
    runtime_image_digest:R.repositoryDigest(fs.readFileSync(process.execPath)),
    effective_environment_hash:R.repositoryDigest(canonicalize({node:process.version,resources:R.RESOURCES,tools:R.TOOLS}))};
  const file=profileFile(),st=fs.lstatSync(file);
  if(!st.isFile()||st.size>65536||st.uid!==0||(st.mode&0o022))throw R.repositoryError('CAPTURE_ENVIRONMENT','Invalid runtime profile.');
  const profile=JSON.parse(fs.readFileSync(file,'utf8'));
  if(profile.version!==1||!path.isAbsolute(profile.root)||!profile.image_digest||!profile.configuration)
    throw R.repositoryError('CAPTURE_ENVIRONMENT','Runtime profile is incomplete.');
  if(profile.configuration.hook_sha256!==R.repositoryDigest(fs.readFileSync(path.join(__dirname,'repository-tool-hook.js'))))throw R.repositoryError('CAPTURE_ENVIRONMENT','Tool boundary differs from pinned configuration.');
  const root=fs.statSync(profile.root);
  if(root.uid!==0||(root.mode&0o222))throw R.repositoryError('CAPTURE_ENVIRONMENT','Runtime snapshot must be root-owned and read-only.');
  const actual=hashRuntime(profile.root);
  if(actual!==profile.image_digest)throw R.repositoryError('CAPTURE_ENVIRONMENT','Mounted runtime bytes differ.');
  return {runtime_image_digest:actual,effective_environment_hash:R.repositoryDigest(canonicalize(profile.configuration)),profile};
}
function hashRuntime(root) {
  const hash=crypto.createHash('sha256');
  let count=0,total=0;const began=Date.now();
  function walk(rel='') {
    const file=path.join(root,rel),st=fs.lstatSync(file);
    if(++count>200000||Date.now()-began>30000||rel.split('/').length>32)throw R.repositoryError('CAPTURE_ENVIRONMENT','Runtime entry cap.');
    hash.update(rel+'\0'+(st.mode&4095)+'\0');
    if(st.isSymbolicLink()){hash.update('link\0'+fs.readlinkSync(file));return;}
    if(st.isDirectory()){for(const n of fs.readdirSync(file).sort())walk(rel?rel+'/'+n:n);return;}
    if(!st.isFile())throw R.repositoryError('CAPTURE_ENVIRONMENT','Runtime contains a special file.');
    if((total+=st.size)>4294967296)throw R.repositoryError('CAPTURE_ENVIRONMENT','Runtime byte cap.');
    const fd=fs.openSync(file,'r'),buf=Buffer.alloc(1024*1024);try{let n;while((n=fs.readSync(fd,buf,0,buf.length,null))){if(Date.now()-began>30000)throw R.repositoryError('CAPTURE_ENVIRONMENT','Runtime validation time limit.');hash.update(buf.subarray(0,n));}}finally{fs.closeSync(fd);}
  }
  walk();return hash.digest('hex');
}
// Do not dump argv, environment objects or stacks into diagnostic records.
// Runtime suppression is broader than the separate, gate-only repository scanner.
function redactRepositoryDiagnostics(value,limit=4096,tail=false) {
  let text=String(value??'')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'')
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,'[redacted]')
    .replace(/\/(?:home|Users)\/[^/\s"'\\]+|\/root(?=\/|\b)/g,'~')
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,'[redacted]');
  text=text.split('\n').map(line=>{
    const credential=/\b(?:[\w-]*(?:token|secret|password|passwd|api[_-]?key|credential)[\w-]*|authorization|cookie)["']?\s*[:=]\s*\S/i;
    if(/\b(?:sk-[A-Za-z0-9_-]+|gh[pousr]_[A-Za-z0-9]+|AKIA[0-9A-Z]+|eyJ[A-Za-z0-9_=-]+\.[A-Za-z0-9_.=-]+)\b/.test(line)||
      /\b(?:\d{1,3}\.){3}\d{1,3}\b|\bip-[\d-]+\.[a-z0-9.-]*compute\.(?:internal|amazonaws\.com)/i.test(line)||credential.test(line)||
      /\b(?:Bearer|Basic)\s+\S+|--[\w-]*(?:token|password|secret|api-key)\s+\S+|:\/\/[^/\s]+:[^/\s]+@/i.test(line)||
      /[A-Za-z0-9_+/=-]{48,}/.test(line))return '[redacted]';
    return line.replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
  }).join('\n');
  const bytes=Buffer.from(text);
  return (tail?bytes.subarray(Math.max(0,bytes.length-limit)):bytes.subarray(0,limit)).toString('utf8').replace(/^\uFFFD+|\uFFFD+$/g,'');
}
function repositoryProcessDiagnostics(result={}) {
  return {exit_code:Number.isInteger(result.code??result.status)?(result.code??result.status):null,
    signal:typeof result.signal==='string'?redactRepositoryDiagnostics(result.signal,64):null,
    timed_out:result.timedOut===true||result.error?.code==='ETIMEDOUT',
    stdout_prefix:redactRepositoryDiagnostics(result.stdout),stderr_tail:redactRepositoryDiagnostics(result.stderr,4096,true)};
}
function repositoryExecutionFailure(code,message,result,boundary) {
  const diagnostics=repositoryProcessDiagnostics(result);
  const e=R.repositoryError(code,redactRepositoryDiagnostics(message,1024)+' '+JSON.stringify(diagnostics));
  e.diagnostics=diagnostics;
  if(boundary&&typeof boundary==='object'){
    e.boundary_diagnostics=repositoryProcessDiagnostics({code:boundary.exit_code,signal:boundary.signal,
      timedOut:boundary.timed_out,stdout:boundary.stdout_prefix,stderr:boundary.stderr_tail});
    e.message+=' Boundary: '+JSON.stringify(e.boundary_diagnostics);
  }
  return e;
}
function buildPlan({bin,args,user,trusted=false,timeoutMs,snapshot=false,phase='generation'}) {
  assertRequest({surface:'claude-cli',trusted});
  const env=environment();
  const repository={...R.policy({timeoutMs}),runtime_image_digest:env.runtime_image_digest,effective_environment_hash:env.effective_environment_hash};
  const scope='driftproof-490-'+crypto.randomBytes(12).toString('hex');
  // HOP_LABEL remains a stable boundary in the plan for request inspection.
  if(!['generation','hidden-tests'].includes(phase)||phase==='hidden-tests'&&snapshot)throw R.repositoryError('EXECUTION_PHASE','Invalid execution phase.');
  const supervisor=phase==='hidden-tests'?require('./hidden-supervisor').hiddenSupervisorPath():require('./repository-supervisor').supervisorPath();
  const argv=['-n','/usr/bin/systemd-run','--scope','--quiet','--collect','--unit='+scope,
    '-p','MemoryMax=512M','-p','MemorySwapMax=0','-p','OOMPolicy=kill','-p','TasksMax=64','-p','CPUQuota=100%',
    '-p','RuntimeMaxSec='+(Math.ceil(repository.limits.timeout_ms/1000)+60),'-p','KillMode=control-group',
    '/usr/bin/unshare','--mount','--propagation','private','--',process.execPath,supervisor,'--profile',profileFile(),'--timeout-ms',String(repository.limits.timeout_ms),'--user',user,...(snapshot?['--snapshot']:[]),'--','driftproof-eval-hop',bin,...args];
  return {mode:'isolated',user,file:'/usr/bin/sudo',args:argv,env:{},collect:'repository',repository,scope,
    executable:bin,command_args:args};
}
async function collectProcess(plan,{input='',timeoutMs=plan.repository?.limits.timeout_ms??R.LIMITS.timeout_ms,graceMs=5000,privateInput}={}) {
  return new Promise((resolve,reject)=>{
    const child=cp.spawn(plan.file,plan.args,{env:plan.env,stdio:['pipe','pipe','pipe',...(privateInput?['pipe']:[])],...(plan.cwd?{cwd:plan.cwd}:{})});
    const out=[];let err=Buffer.alloc(0),size=0,es=0,limit=false,timedOut=false,done=false;
    const stdoutCap=plan.repository?2*R.RESOURCES.stream_bytes+2097152:R.RESOURCES.stream_bytes;
    let hardTimer;const kill=()=>{child.kill('SIGTERM');hardTimer ||= setTimeout(()=>child.kill('SIGKILL'),5000);};
    const timer=setTimeout(()=>{timedOut=true;kill();},timeoutMs+graceMs);
    child.on('error',e=>{clearTimeout(timer);reject(e);});
    child.stdout.on('data',buf=>{if(size<stdoutCap)out.push(buf.subarray(0,stdoutCap-size));size+=buf.length;if(size>stdoutCap){limit=true;kill();}});
    child.stderr.on('data',buf=>{es+=buf.length;err=Buffer.concat([err,buf]);if(err.length>65536)err=Buffer.from(err.subarray(err.length-65536));if(es>65536){limit=true;kill();}});
    child.on('close',(code,signal)=>{
      if(done)return;done=true;clearTimeout(timer);clearTimeout(hardTimer);child.stdin.end();
      // Drop a clipped first line, which could start halfway through a credential.
      if(es>65536){const newline=err.indexOf(10);err=newline<0?Buffer.alloc(0):err.subarray(newline+1);}
      resolve({code,signal,stdout:Buffer.concat(out).toString('utf8'),stderr:err.toString('utf8'),timedOut,
        ...(limit?{delivery:{complete:false,terminal_status:'resource_limit',resource_kind:'stream_bytes'}}:{})});
    });
    child.stdin.on('error',()=>{});
    if(privateInput){child.stdio[3].on('error',()=>{});child.stdio[3].end(privateInput);}
    // A live supervisor holds this pipe as an owner lease. EOF terminates its scope.
    if(plan.repository)child.stdin.write(JSON.stringify({input,owner_pid:process.pid,owner_start:fs.readFileSync('/proc/self/stat','utf8').split(') ')[1].split(' ')[19]})+'\n');
    else {child.stdin.end(input);}
  });
}
async function execute(plan,opts) {
  const expected=environment();
  for(const k of ['runtime_image_digest','effective_environment_hash'])if(plan.repository[k]!==expected[k])
    throw R.repositoryError('CAPTURE_ENVIRONMENT','Runtime identity differs before dispatch.');
  if(stubRunner) {
    if(process.env.DRIFTPROOF_STUB!=='1')throw R.repositoryError('CAPTURE_ISOLATION','Stub runner cannot execute a live call.');
    return {...await stubRunner(plan,opts),evidence_kind:'simulated'};
  }
  const C=require('./checkpoint');C.scopeStarted(plan.scope);
  let result;try{result=await collectProcess(plan,opts);}finally{C.scopeStopped(plan.scope);}
  if(result.delivery)return {...result,diagnostics:repositoryProcessDiagnostics(result)};
  let frame;try{frame=JSON.parse(result.stdout);}catch{}
  if(!frame||typeof frame!=='object'||Array.isArray(frame)||(!frame.error&&(!frame.result||typeof frame.result!=='object'||Array.isArray(frame.result)||typeof frame.runtime_image_digest!=='string')))
    throw repositoryExecutionFailure('CAPTURE_COLLECTION','Supervisor evidence is incomplete.',result);
  if(frame.error)throw repositoryExecutionFailure(typeof frame.error.code==='string'?frame.error.code:'CAPTURE_ISOLATION','Repository boundary refused execution. '+redactRepositoryDiagnostics(frame.error.message,1024),result,frame.error.diagnostics);
  if(result.timedOut||result.code!==0||result.signal)throw repositoryExecutionFailure('CAPTURE_SUPERVISOR','Supervisor did not complete cleanly.',result);
  if(frame.runtime_image_digest!==expected.runtime_image_digest)throw R.repositoryError('CAPTURE_ENVIRONMENT','Execution image identity differs.');
  return frame.result;
}
function summaryLines(receipt) {
  const draws=receipt.results.cases.flatMap(c=>c.generation?.draws||[]);
  const calls=draws.reduce((n,d)=>n+(d.delivery?.observed_tool_calls||0),0);
  const results=draws.reduce((n,d)=>n+(d.delivery?.observed_tool_results||0),0);
  const complete=draws.length>0&&draws.every(d=>d.delivery?.complete===true);
  const omissions=draws.reduce((n,d)=>n+(d.collection?.omissions||0),0);
  const enumerated=draws.every(d=>d.collection?.enumeration_complete===true);
  const a=receipt.run.accounting;
  const accounting=a?['Surface-reported cost (subscription accounting, not an API bill): $'+a.reported_cost_usd.toFixed(6)+'; unknown cost attempts: '+a.unknown_cost_attempts+'.',
    'Tool errors: '+a.tool_errors+'; interrupted attempts: '+a.interrupted_attempts+'; total attempts: '+a.attempts+'.']:[];
  return [...accounting,'Tools available: '+R.TOOLS.join(', ')+'.',
    'Observed tool calls: '+calls+'; observed tool results: '+results+'; totals: '+(complete?'complete':'unknown')+'.',
    'Capture omissions: '+omissions+'; enumeration: '+(enumerated?'complete':'incomplete')+'; total omissions: '+(enumerated?omissions:'unknown')+'.'];
}
function assertQuiescent(unit){
  if(!/^driftproof-490-[a-f0-9]{24}$/.test(unit))throw R.repositoryError('RESUME_NOT_QUIESCENT','Invalid execution scope.');
  const r=cp.spawnSync('/usr/bin/systemctl',['show',unit+'.scope','--property=ActiveState','--value'],{env:{},encoding:'utf8',timeout:10000,maxBuffer:4096});
  if(r.error||r.status!==0||!['inactive','failed'].includes(r.stdout.trim()))throw R.repositoryError('RESUME_NOT_QUIESCENT','Previous execution scope has not stopped.');
  // A failed unit is acceptable only after every task has exited.
  const folder='/sys/fs/cgroup/system.slice/'+unit+'.scope';
  try{if(fs.readFileSync(folder+'/cgroup.procs','utf8').trim())throw R.repositoryError('RESUME_NOT_QUIESCENT','Previous execution scope contains processes.');}
  catch(e){if(e.code!=='ENOENT')throw e;}
}
module.exports={redactRepositoryDiagnostics,repositoryProcessDiagnostics,repositoryExecutionFailure,profileFile,assertQuiescent,assertRequest,environment,hashRuntime,buildPlan,execute,collectProcess,setStubRunner,summaryLines};
