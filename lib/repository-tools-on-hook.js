// SPDX-License-Identifier: Apache-2.0
'use strict';
// Issue 786. The tools-on mode's hook: the default hook's decisions, plus the Skill tool for a skill
// the draw's world installed. The default hook's bytes stay as its runtime profile pins them.
const fs=require('node:fs'),path=require('node:path');
const base=require('./repository-tool-hook');
function decideRepositoryTool(config,event){
  const toolsOn=config.mode==='repository-tools-on';
  // A draw with a tool session runs Bash there, in its loopback namespace, for the whole draw.
  if(toolsOn&&config.session&&event.tool_name==='Bash'){
    const input=event.tool_input||{};
    if(event.cwd&&event.cwd!==config.workspace)throw Error('Tool working directory differs.');
    if(typeof input.command!=='string'||Buffer.byteLength(input.command)>65536||input.dangerouslyDisableSandbox)throw Error('Invalid shell request.');
    return {hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'allow',
      updatedInput:{...input,command:require('./repository-session').clientCommand(config.session,input.command,120000),run_in_background:false,timeout:130000}}};
  }
  if(event.tool_name!=='Skill'||!toolsOn)return base.decideRepositoryTool(config,event);
  if(event.cwd&&event.cwd!==config.workspace)throw Error('Tool working directory differs.');
  const input=event.tool_input||{};
  // The skill's name is read from the tool's own input; a leading slash is the command spelling.
  const asked=[input.skill,input.command,input.name].find(x=>typeof x==='string');
  if(!Array.isArray(config.skills)||typeof asked!=='string'||!config.skills.includes(asked.replace(/^\//,'')))
    throw Error('Skill is not installed in this draw.');
  return {hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'allow'}};
}
async function main(){
  const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
  let text='';for await(const b of process.stdin){text+=b;if(Buffer.byteLength(text)>262144)throw Error('Hook input limit.');}
  const event=JSON.parse(text);
  const lock=path.join(config.control,'tool-owner');
  if(event.hook_event_name==='PostToolUse'||event.hook_event_name==='PostToolUseFailure'){
    try{if(fs.readFileSync(lock,'utf8')===event.tool_use_id)fs.unlinkSync(lock);}catch(e){if(e.code!=='ENOENT')throw e;}
    return;
  }
  let fd;
  try{
    fd=fs.openSync(lock,'wx',0o600);fs.writeFileSync(fd,event.tool_use_id||'');fs.closeSync(fd);fd=null;
    const decision=decideRepositoryTool(config,event);
    // The hook's own record of admitted Skill calls, read beside the stream (spec 786 AC-11).
    if(event.tool_name==='Skill')fs.appendFileSync(path.join(config.control,'skill-calls.jsonl'),JSON.stringify({tool_use_id:event.tool_use_id||null,input:event.tool_input||{}})+'\n',{mode:0o600});
    process.stdout.write(JSON.stringify(decision)+'\n');
  }catch(e){
    if(fd!==undefined&&fd!==null)fs.closeSync(fd);
    if(e.code!=='EEXIST')try{fs.unlinkSync(lock);}catch{}
    process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'deny',
      permissionDecisionReason:'Repository tool boundary refused this request.'}})+'\n');
  }
}
if(require.main===module)main().catch(()=>{process.stderr.write('Repository hook refused.\n');process.exitCode=2;});
function hookCommand(){return '/usr/bin/node /control/repository-tools-on-hook.js /control/config.json';}
module.exports={decideRepositoryTool,hookCommand};
