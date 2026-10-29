// SPDX-License-Identifier: Apache-2.0
'use strict';
// Immutable CLI hooks serialize tools. Bash gets a fresh PID, mount and network namespace.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
function quote(s){return "'"+String(s).replace(/'/g,"'\\''")+"'";}
function inside(root,file,create=false){
  if(typeof file!=='string'||!/^[A-Za-z0-9._/\-]*$/.test(file))throw Error('Unsupported tool path spelling.');
  const resolved=path.resolve(root,file||'.');
  if(resolved!==root&&!resolved.startsWith(root+'/'))throw Error('Path is outside this draw.');
  const rel=path.relative(root,resolved);let at=root;
  for(const part of rel.split('/').filter(Boolean)){
    at=path.join(at,part);
    try{if(fs.lstatSync(at).isSymbolicLink())throw Error('Links are not admitted to file tools.');}
    catch(e){if(e.code!=='ENOENT'||!create)throw e;}
  }
  return resolved;
}
function scan(root){
  let count=0;const start=Date.now();
  function walk(dir,depth){
    if(depth>32||Date.now()-start>5000)throw Error('Tool preflight limit.');
    const stream=fs.opendirSync(dir);
    try{for(let e;(e=stream.readSync());){
      if(++count>4096)throw Error('Tool entry limit.');
      if(e.isSymbolicLink()||(!e.isFile()&&!e.isDirectory()))throw Error('Links and special files are not admitted to file tools.');
      if(e.isDirectory())walk(path.join(dir,e.name),depth+1);
    }}finally{stream.closeSync();}
  }
  walk(root,0);
}
function toolCommand(config,command){
  // Neither the host root nor authentication material is mounted in this namespace.
  // Clear before exec too: a bwrap namespace-init process can retain its initial environ.
  return ['/usr/bin/env','-i','/usr/bin/prlimit','--cpu=120:120','--fsize=67108864:67108864','--nofile=128:128','--',
    '/usr/bin/bwrap','--unshare-all','--die-with-parent','--new-session','--cap-drop','ALL',
    '--ro-bind',config.image,'/','--bind',config.workspace,'/workspace',
    '--proc','/proc','--dev','/dev','--bind',config.temp,'/tmp','--chdir','/workspace',
    '--clearenv','--setenv','HOME','/workspace','--setenv','PATH','/usr/bin:/bin',
    '/bin/bash','--noprofile','--norc','-c',command].map(quote).join(' ');
}
function decideRepositoryTool(config,event){
  const name=event.tool_name,input=event.tool_input||{};
  if(event.cwd&&event.cwd!==config.workspace)throw Error('Tool working directory differs.');
  if(!['Read','Glob','Grep','Write','Edit','Bash'].includes(name))throw Error('Tool is not admitted.');
  if(name==='Bash'){
    if(typeof input.command!=='string'||Buffer.byteLength(input.command)>65536||input.dangerouslyDisableSandbox)
      throw Error('Invalid shell request.');
    return {hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'allow',
      updatedInput:{...input,command:toolCommand(config,input.command),run_in_background:false,timeout:120000}}};
  }
  scan(config.workspace);
  inside(config.workspace,input.file_path||input.path||'.',name==='Write');
  // File tools cannot follow link targets created by another tool while this lease is held.
  const glob=name==='Glob'?input.pattern:input.glob;
  if(glob!==undefined&&(!/^[A-Za-z0-9._/*?\[\]\-]+$/.test(glob)||glob.includes('..')||path.isAbsolute(glob)))
    throw Error('Glob pattern escapes this draw.');
  return {hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'allow'}};
}
async function main(){
  const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
  let text='';for await(const b of process.stdin){text+=b;if(Buffer.byteLength(text)>262144)throw Error('Hook input limit.');}
  const event=JSON.parse(text);
  const lock=path.join(config.control,'tool-owner');
  if(event.hook_event_name==='PostToolUse'||event.hook_event_name==='PostToolUseFailure'){
    // Only release the owner of this tool invocation.
    try{if(fs.readFileSync(lock,'utf8')===event.tool_use_id)fs.unlinkSync(lock);}catch(e){if(e.code!=='ENOENT')throw e;}
    return;
  }
  // A tool queued behind a still-active tool is denied. No wait, implicit retry or overlap.
  let fd;
  try{
    fd=fs.openSync(lock,'wx',0o600);fs.writeFileSync(fd,event.tool_use_id||'');fs.closeSync(fd);fd=null;
    process.stdout.write(JSON.stringify(decideRepositoryTool(config,event))+'\n');
  }catch(e){
    if(fd!==undefined&&fd!==null)fs.closeSync(fd);
    if(e.code!=='EEXIST')try{fs.unlinkSync(lock);}catch{}
    process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'deny',
      permissionDecisionReason:'Repository tool boundary refused this request.'}})+'\n');
  }
}
if(require.main===module)main().catch(()=>{process.stderr.write('Repository hook refused.\n');process.exitCode=2;});
function hookCommand(){return '/usr/bin/node /control/repository-tool-hook.js /control/config.json';}
module.exports={inside,decideRepositoryTool,toolCommand,hookCommand};
