// SPDX-License-Identifier: Apache-2.0
'use strict';
// Operator-owned control process. No login or credential is read in this phase.
const fs=require('node:fs'),path=require('node:path');
const E=require('./repository-execution'),R=require('./repository'),S=require('./workspace-snapshot'),H=require('./hidden-execution');
const B=require('./repository-supervisor');
async function main(){
 if(process.getuid()!==0||process.env.DRIFTPROOF_STUB==='1')throw R.repositoryError('EXECUTION_ISOLATION','Hidden supervisor requires a live operator scope.');
 const args=process.argv.slice(2),user=args[args.indexOf('--user')+1];
 if(!/^[a-z_][a-z0-9_-]{0,31}$/.test(user)||user==='root')throw Error('Invalid eval user.');
 process.env.DRIFTPROOF_REPOSITORY_PROFILE=args[args.indexOf('--profile')+1];
 const env=E.environment(),row=fs.readFileSync('/etc/passwd','utf8').split('\n').find(x=>x.split(':')[0]===user)?.split(':');
 const uid=Number(row?.[2]),gid=Number(row?.[3]);if(!Number.isSafeInteger(uid)||uid<=0||!Number.isSafeInteger(gid)||gid<=0)throw Error('Invalid eval credentials.');
 const cg=fs.readFileSync('/proc/self/cgroup','utf8').split('\n').find(x=>x.startsWith('0::'))?.slice(3);
 if(!cg?.includes('/driftproof-490-'))throw Error('Execution scope absent.');B.verifyRepositoryScope('/sys/fs/cgroup'+cg);
 const root=fs.mkdtempSync('/var/tmp/driftproof-490-tests-');let mounted=false,finished=false;
 const cleanup=()=>{if(finished)return;finished=true;B.stopChildren();if(mounted)B.supervisorCommand('/usr/bin/umount',['-l',root]);fs.rmSync(root,{recursive:true,force:true});};
 for(const signal of ['SIGTERM','SIGINT','SIGHUP'])process.on(signal,()=>{cleanup();process.exit(143);});
 process.stdin.on('end',()=>{if(!finished){cleanup();process.exit(143);}});
 try{
  const frame=await B.readLease(2*S.LIMITS.encoded),job=JSON.parse(frame.input);S.validateWorkspaceSnapshot(job.snapshot,env.runtime_image_digest);H.validateHiddenCase(job.caseSpec);
  B.supervisorCommand('/usr/bin/mount',['-t','tmpfs','-o','size=268435456,nr_inodes=4096,nosuid,nodev','tmpfs',root]);mounted=true;fs.chmodSync(root,0o755);
  const workspace=path.join(root,'workspace'),control=path.join(root,'control'),temp=path.join(root,'temp');
  S.restoreWorkspaceSnapshot(job.snapshot,workspace);
  if(S.captureWorkspaceSnapshot(workspace,env.runtime_image_digest).snapshot_hash!==job.snapshot.snapshot_hash)throw Error('Restored snapshot bytes or modes differ.');
  const files=H.prepareHiddenExecution(control,temp,workspace,job.caseSpec);
  function own(file){const st=fs.lstatSync(file);fs.chownSync(file,uid,gid);if(st.isDirectory())for(const n of fs.readdirSync(file))own(path.join(file,n));}
  own(workspace);own(temp);
  const launch=H.hiddenExecutionLaunch({image:env.profile.root,workspace,control,temp,uid,gid,language:job.caseSpec.language});
  const result=await E.collectProcess(launch,{input:'',timeoutMs:H.WALL_MS,graceMs:0});await B.quiesce();
  let report;try{report=H.readHiddenReport(files.report);}catch{}
  // Observe the executing interpreter's cgroup, not just the outer declaration.
  if(!report?.scope?.split('\n').includes('0::'+cg))throw E.repositoryExecutionFailure('EXECUTION_ISOLATION','Test interpreter scope evidence differs.',result);
  const execution=H.hiddenExecutionOutcome(job.caseSpec,result,report);
  cleanup();process.stdout.write(JSON.stringify({runtime_image_digest:env.runtime_image_digest,result:{execution}})+'\n');
 }finally{try{cleanup();}finally{process.stdin.destroy();}}
}
if(require.main===module)main().catch(e=>{process.stdout.write(JSON.stringify({error:{code:e.code||'EXECUTION_HARNESS',message:E.redactRepositoryDiagnostics(e.message,1024),...(e.diagnostics?{diagnostics:e.diagnostics}:{})}})+'\n');process.exitCode=1;});

function hiddenSupervisorPath(){return __filename;}
module.exports={hiddenSupervisorPath};
