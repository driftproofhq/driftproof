// SPDX-License-Identifier: Apache-2.0
'use strict';
// Runs only inside the operator's transient cgroup scope.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const R=require('./repository'),E=require('./repository-execution');
function supervisorCommand(file,args,opts={}){
  const r=cp.spawnSync(file,args,{env:{PATH:'/usr/bin:/bin'},encoding:'utf8',timeout:30000,maxBuffer:2097152,...opts});
  if(r.error||r.status!==0)throw E.repositoryExecutionFailure('CAPTURE_ISOLATION','Required boundary command failed: '+path.basename(file)+'.',r);
  return r.stdout.trim();
}
function processes(){
  const row=fs.readFileSync('/proc/self/cgroup','utf8').split('\n').find(x=>x.startsWith('0::'));
  if(!row||!row.includes('driftproof-490-'))throw R.repositoryError('CAPTURE_ISOLATION','Not in the required execution scope.');
  return fs.readFileSync('/sys/fs/cgroup'+row.slice(3)+'/cgroup.procs','utf8').trim().split(/\s+/).filter(Boolean).map(Number);
}
function stopChildren(){for(const pid of processes())if(pid!==process.pid)try{process.kill(pid,'SIGKILL');}catch(e){if(e.code!=='ESRCH')throw e;}}
function supervisorCallOptions(args){
  const at=args.indexOf('--timeout-ms');
  const limits=R.policy({timeoutMs:at<0?undefined:Number(args[at+1])}).limits;
  return {timeoutMs:limits.timeout_ms,graceMs:0};
}
function verifyRepositoryScope(cg,read=fs.readFileSync) {
  for(const [file,max] of [['memory.max',R.RESOURCES.memory],['pids.max',R.RESOURCES.processes]]){
    const value=read(cg+'/'+file,'utf8').trim();
    if(!/^\d+$/.test(value)||Number(value)>max)throw R.repositoryError('CAPTURE_ISOLATION','Scope quota absent: '+file+'.');
  }
  if(read(cg+'/memory.oom.group','utf8').trim()!=='1')throw R.repositoryError('CAPTURE_ISOLATION','Scope group OOM policy absent.');
}
async function quiesce(){
  const until=Date.now()+5000;
  do{stopChildren();if(processes().every(pid=>pid===process.pid))return;await new Promise(r=>setTimeout(r,20));}while(Date.now()<until);
  throw R.repositoryError('CAPTURE_QUIESCENCE','Generation descendants did not stop.');
}
function readLease(limit=1048576){return new Promise((resolve,reject)=>{
  const chunks=[];let size=0;
  const receive=chunk=>{size+=chunk.length;if(size>limit){process.stdin.off('data',receive);reject(R.repositoryError('CAPTURE_INPUT','Input limit.'));return;}
    chunks.push(chunk);const all=Buffer.concat(chunks),end=all.indexOf(10);if(end<0)return;process.stdin.off('data',receive);
    try{const frame=JSON.parse(all.subarray(0,end).toString('utf8'));
      if(!Number.isSafeInteger(frame.owner_pid)||frame.owner_pid<=0)throw Error('Invalid owner');
      const start=fs.readFileSync('/proc/'+frame.owner_pid+'/stat','utf8').split(') ')[1].split(' ')[19];
      if(start!==frame.owner_start||typeof frame.input!=='string')throw Error('Invalid owner lease');resolve(frame);
    }catch{reject(R.repositoryError('CAPTURE_OWNER','Owner lease is invalid.'));}};
  process.stdin.on('data',receive);process.stdin.resume();
});}
function authProbeEvidence(control,result,secret){
  // Inspect the full collected output before deriving or publishing diagnostics.
  require('./repository-auth').assertCredentialAbsent(result,secret);
  const name='auth-hook-evidence.jsonl',limit=65536,file=path.join(control,name);
  let fd,problem,records;
  try{
    const st=fs.lstatSync(file);
    if(!st.isFile()||st.nlink!==1)problem='unsafe';
    else if(st.size>limit)problem='oversized (limit '+limit+' bytes; observed '+st.size+')';
    else{
      fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
      const opened=fs.fstatSync(fd);
      if(!opened.isFile()||opened.dev!==st.dev||opened.ino!==st.ino)problem='unsafe';
      else{
        const bytes=Buffer.alloc(limit+1);let at=0,n;
        while(at<bytes.length&&(n=fs.readSync(fd,bytes,at,bytes.length-at,null))>0)at+=n;
        if(at>limit)problem='oversized (limit '+limit+' bytes)';
        else if(!at)problem='empty';
        else{
          try{
            records=bytes.subarray(0,at).toString('utf8').split('\n').filter(Boolean).map(JSON.parse);
            if(!records.length)problem='empty';
            else if(!records.every(r=>r&&Object.keys(r).length===4&&Object.keys(r).every(k=>['event','tool','environment_absent','self_absent'].includes(k))&&
              ['PreToolUse','PostToolUse','PostToolUseFailure'].includes(r.event)&&R.TOOLS.includes(r.tool)&&typeof r.environment_absent==='boolean'&&typeof r.self_absent==='boolean'))problem='malformed';
          }catch{problem='malformed';}
        }
      }
    }
  }catch(e){problem=e.code==='ENOENT'?'missing':e.code==='ELOOP'?'unsafe':'unreadable';}
  finally{if(fd!==undefined)fs.closeSync(fd);}
  const failed=result.code!==0||result.signal||result.timedOut||result.delivery||result.error;
  if(problem||failed){
    let replies=0,tools=0;const details=[];
    // CLI JSON often contains usage fields that cause whole-line redaction. Extract
    // only bounded error text, never arbitrary fields, before the common redactor.
    for(const line of String(result.stdout||'').split('\n')){
      let row;try{row=JSON.parse(line);}catch{continue;}
      if(row?.type==='assistant'&&Array.isArray(row.message?.content)){
        replies++;tools+=row.message.content.filter(c=>c?.type==='tool_use').length;
      }
      if(details.length<4&&row?.type==='result'&&row.is_error===true){
        if(typeof row.result==='string')details.push(E.redactRepositoryDiagnostics(row.result,1024));
        for(const v of Array.isArray(row.errors)?row.errors.slice(0,4-details.length):[])if(typeof v==='string')details.push(E.redactRepositoryDiagnostics(v,1024));
      }
    }
    const observed={provider_replies_observed:replies,tool_uses_observed:tools,server_acceptance:replies?'reply_observed':'not_established'};
    const diagnosticResult=details.length?{...result,stdout:JSON.stringify({failure_details:details,...observed})}:result;
    throw E.repositoryExecutionFailure('CLI_EXIT',(failed?'CLI process failed before hook admission. ':'Authentication hook evidence refused. ')+name+': '+(problem||'present')+'. '+JSON.stringify(observed),diagnosticResult);
  }
  return records;
}
async function main(){
  if(process.getuid()!==0)throw R.repositoryError('CAPTURE_ISOLATION','Supervisor requires the operator scope.');
  const args=process.argv.slice(2),profile=args[args.indexOf('--profile')+1],user=args[args.indexOf('--user')+1];
  const callOptions=supervisorCallOptions(args);
  if(!/^[a-z_][a-z0-9_-]{0,31}$/.test(user)||user==='root')throw R.repositoryError('CAPTURE_ISOLATION','Invalid eval user.');
  process.env.DRIFTPROOF_REPOSITORY_PROFILE=profile;
  const env=E.environment(),image=env.profile.root;
  const row=fs.readFileSync('/etc/passwd','utf8').split('\n').find(x=>x.split(':')[0]===user)?.split(':');
  if(!row||Number(row[2])===0)throw R.repositoryError('CAPTURE_ISOLATION','Eval user absent.');
  const uid=Number(row[2]),gid=Number(row[3]);
  if(!Number.isSafeInteger(uid)||uid<=0||!Number.isSafeInteger(gid)||gid<=0)throw R.repositoryError('CAPTURE_ISOLATION','Invalid eval credentials.');
  // Scope properties are observed, not accepted from the caller's declaration.
  const cg=fs.readFileSync('/proc/self/cgroup','utf8').split('\n').find(x=>x.startsWith('0::')).slice(3);
  verifyRepositoryScope('/sys/fs/cgroup'+cg);
  const root=fs.mkdtempSync('/var/tmp/driftproof-490-draw-');
  let mounted=false,finished=false,secret=null;
  const cleanup=()=>{if(finished)return;finished=true;stopChildren();if(mounted)supervisorCommand('/usr/bin/umount',['-l',root]);fs.rmSync(root,{recursive:true,force:true});};
  for(const signal of ['SIGTERM','SIGINT','SIGHUP'])process.on(signal,()=>{cleanup();process.exit(143);});
  process.stdin.on('end',()=>{if(!finished){cleanup();process.exit(143);}});
  try{
    supervisorCommand('/usr/bin/mount',['-t','tmpfs','-o','size=268435456,nr_inodes=4096,nosuid,nodev','tmpfs',root]);mounted=true;
    fs.chmodSync(root,0o755);
    const workspace=path.join(root,'workspace'),control=path.join(root,'control'),temp=path.join(root,'temp'),auth=path.join(root,'auth');
    fs.mkdirSync(path.join(auth,'.claude'),{recursive:true,mode:0o700});
    fs.chownSync(auth,uid,gid);fs.chownSync(path.join(auth,'.claude'),uid,gid);
    fs.mkdirSync(temp,{mode:0o700});fs.chownSync(temp,uid,gid);
    R.copyRepositoryWorkspace(R.STARTER,workspace,R.repositoryManifest(R.STARTER));
    fs.mkdirSync(control,{mode:0o755});
    for(const f of ['repository.js','repository-tool-hook.js','repository-auth.js','canonical.js']){
      fs.copyFileSync(path.join(__dirname,f),path.join(control,f));fs.chmodSync(path.join(control,f),0o444);
    }
    // Directory writes are limited to the tool lease. Immutable config files remain root-owned.
    fs.chownSync(control,uid,gid);fs.chmodSync(control,0o755);
    function own(dir){fs.chownSync(dir,uid,gid);for(const e of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory())own(f);else fs.chownSync(f,uid,gid);}}
    own(workspace);
    const config={workspace:'/workspace',image:'/runtime',control:'/control',temp:'/tooltmp'};
    fs.writeFileSync(path.join(control,'config.json'),JSON.stringify(config),{mode:0o444});
    const hook=args.includes('--auth-probe')?'/usr/bin/node /control/repository-auth.js --probe-hook':require('./repository-tool-hook').hookCommand();
    const hooks=Object.fromEntries(['PreToolUse','PostToolUse','PostToolUseFailure'].map(event=>[event,[{matcher:'.*',hooks:[{type:'command',command:hook,timeout:10}]}]]));
    fs.writeFileSync(path.join(control,'settings.json'),JSON.stringify({hooks,disableAllHooks:false,autoMemoryEnabled:false,syncClaudeAiSkills:false,syncClaudeAiPlugins:false,disableClaudeAiConnectors:true}),{mode:0o444});
    // No PAM here: sudo can move its subtree out of this scope via pam_systemd.
    // setpriv execs with dropped credentials in the already verified cgroup.
    const base=['--reuid='+uid,'--regid='+gid,'--clear-groups','--no-new-privs','--inh-caps=-all','--ambient-caps=-all','--pdeathsig=KILL','--','/usr/bin/env','-i','/usr/bin/prlimit','--cpu=900:900','--fsize=67108864:67108864','--nofile=128:128','--',
      '/usr/bin/bwrap','--unshare-pid','--unshare-ipc','--unshare-uts','--die-with-parent','--new-session','--cap-drop','ALL',
      '--ro-bind',image,'/','--ro-bind',image,'/runtime','--bind',workspace,'/workspace',
      '--bind',control,'/control','--bind',temp,'/tooltmp','--proc','/proc','--dev','/dev','--tmpfs','/tmp','--chdir','/workspace',
      '--clearenv','--setenv','PATH','/usr/bin:/bin','--setenv','HOME','/auth',
      '--setenv','CLAUDE_CODE_MAX_OUTPUT_TOKENS','16384'];
    const at=args.indexOf('driftproof-eval-hop'),bin=args[at+1],cliArgs=args.slice(at+2);
    if(!['claude','node'].includes(bin))throw R.repositoryError('CAPTURE_ISOLATION','Unsupported control executable.');
    // Marker mode exercises the full pipe path without a subscription file or provider call.
    const pipeProbe=args.includes('--auth-fd-probe');
    if(pipeProbe&&(bin!=='claude'||cliArgs.length!==1||cliArgs[0]!=='--help'||args.includes('--auth-probe')))throw R.repositoryError('CAPTURE_INPUT','Descriptor probe permits only CLI help.');
    // Only the CLI receives subscription auth. Pinned CLI subprocesses remove it.
    if(bin==='claude')require('./repository-auth').assertCliAuthentication(path.join(image,'usr/bin/claude'));
    secret=pipeProbe?Buffer.from(['sk','ant','oat01','nonsecret-'+require('node:crypto').randomBytes(24).toString('hex')].join('-')):bin==='claude'?require('./repository-auth').readSubscriptionToken():null;
    const launch=[...base,'--bind',auth,'/auth',...(secret?['/usr/bin/node','/control/repository-auth.js','--cli']:['/usr/bin/'+bin]),...cliArgs];
    if(bin==='claude')launch.push('--settings','/control/settings.json','--no-session-persistence');
    const frame=await new Promise((resolve,reject)=>{
      let line='';
      const receive=chunk=>{
        line+=chunk.toString('utf8');
        if(Buffer.byteLength(line)>1048576){process.stdin.off('data',receive);reject(R.repositoryError('CAPTURE_INPUT','Input limit.'));return;}
        const i=line.indexOf('\n');if(i>=0){process.stdin.off('data',receive);try{resolve(JSON.parse(line.slice(0,i)));}catch(e){reject(e);}}
      };
      process.stdin.on('data',receive);process.stdin.resume();
    });
    const input=frame.input;
    let ownerStart;try{ownerStart=fs.readFileSync('/proc/'+frame.owner_pid+'/stat','utf8').split(') ')[1].split(' ')[19];}catch{}
    if(!ownerStart||ownerStart!==frame.owner_start)throw R.repositoryError('CAPTURE_OWNER','Owner has stopped.');
    if(typeof input!=='string')throw R.repositoryError('CAPTURE_INPUT','Missing input lease.');
    const result=await E.collectProcess({file:'/usr/bin/setpriv',args:launch,env:{}},{input,...callOptions,...(secret?{privateInput:secret}:{})});
    await quiesce();
    if(args.includes('--snapshot'))result.workspace_snapshot=require('./workspace-snapshot').captureWorkspaceSnapshot(workspace,env.runtime_image_digest);
    // Collector executes as the eval uid and returns bytes on the supervisor-owned pipe.
    const collector="const R=require('/control/repository');const fs=require('node:fs');try{const files=R.collectRepositoryWorkspace('/workspace',JSON.parse(fs.readFileSync('/control/manifest.json','utf8')));console.log(JSON.stringify({files,collection:{enumeration_complete:true,omissions:files.filter(f=>!f.included).length}}))}catch(e){console.log(JSON.stringify({files:e.capture?.files||[],collection:e.capture?.collection||{enumeration_complete:false,total:null},error:{code:e.code||'CAPTURE_COLLECTION',path_bytes_hex:e.path_bytes_hex,resource_kind:e.resource_kind}}))}";
    fs.writeFileSync(path.join(control,'manifest.json'),JSON.stringify(R.repositoryManifest(R.STARTER)),{mode:0o444});
    const collected=supervisorCommand('/usr/bin/setpriv',[...base,'--unshare-net','/usr/bin/node','-e',collector],{env:{}});
    const capture=JSON.parse(collected);
    result.workspace=capture.files;result.collection=capture.collection;
    if(capture.error)result.delivery={complete:false,terminal_status:capture.error.code==='CAPTURE_RESOURCE_LIMIT'?'resource_limit':'incomplete_evidence',reason:capture.error.code,...(capture.error.path_bytes_hex?{path_bytes_hex:capture.error.path_bytes_hex}:{}),...(capture.error.resource_kind?{resource_kind:capture.error.resource_kind}:{})};
    if(args.includes('--auth-probe'))result.auth_hooks=authProbeEvidence(control,result,secret);
    require('./repository-auth').assertCredentialAbsent(result,secret);
    if(secret)secret.fill(0);
    cleanup();
    process.stdout.write(JSON.stringify({runtime_image_digest:env.runtime_image_digest,result})+'\n');
  }finally{if(secret)secret.fill(0);try{cleanup();}finally{process.stdin.destroy();}}
}
if(require.main===module)main().catch(e=>{process.stdout.write(JSON.stringify({error:{code:e.code||'CAPTURE_ISOLATION',message:E.redactRepositoryDiagnostics(e.message,1024),...(e.diagnostics?{diagnostics:e.diagnostics}:{})}})+'\n');process.exitCode=1;});
function supervisorPath(){return __filename;}
module.exports={authProbeEvidence,supervisorCommand,supervisorPath,supervisorCallOptions,verifyRepositoryScope,quiesce,readLease,stopChildren};
