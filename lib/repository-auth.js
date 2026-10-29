// SPDX-License-Identifier: Apache-2.0
'use strict';
const fs=require('node:fs');
// This pinned CLI removes OAuth from Bash and hook environments before exec.
const CLI_SHA256='3920489a5109cff5786a1a392c25277408ff22bc796d5edb9c16a60e5a1718f0';
function assertCliAuthentication(file){
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{const st=fs.fstatSync(fd);if(!st.isFile()||st.size>536870912)throw refusal();const hash=require('node:crypto').createHash('sha256'),buf=Buffer.alloc(1048576);let n;while((n=fs.readSync(fd,buf,0,buf.length,null)))hash.update(buf.subarray(0,n));if(hash.digest('hex')!==CLI_SHA256)throw refusal();}finally{fs.closeSync(fd);}
}
const DIRECTORY='/etc/driftproof',NAME='eval-oauth-token',MAX_BYTES=4096;
const MESSAGE='Repository subscription authentication refused. Run claude setup-token and install its output in /etc/driftproof/eval-oauth-token. Require a root-owned directory 0700, regular file 0600. No login or API fallback.';
function refusal(){return Object.assign(new Error(MESSAGE),{code:'CLI_EXIT'});}
function tokenBytes(bytes){
 // Accept a single terminal newline from secure operator file creation, not other whitespace.
 if(bytes.length&&bytes.at(-1)===10)bytes=bytes.subarray(0,bytes.length-1);
 if(bytes.length>MAX_BYTES||!/^sk-ant-oat01-[A-Za-z0-9_-]{16,}$/.test(bytes.toString('ascii'))||bytes.some(b=>b>127))throw refusal();
 return Buffer.from(bytes);
}
function readSubscriptionToken({directory=DIRECTORY,io=fs,uid=process.getuid()}={}){
 let dir,fd;
 try{
  if(uid!==0)throw refusal();
  dir=io.openSync(directory,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
  const d=io.fstatSync(dir);if(!d.isDirectory()||d.uid!==0||d.gid!==0||(d.mode&0o7777)!==0o700)throw refusal();
  fd=io.openSync('/proc/self/fd/'+dir+'/'+NAME,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  const before=io.fstatSync(fd);
  if(!before.isFile()||before.nlink!==1||before.uid!==0||before.gid!==0||(before.mode&0o7777)!==0o600||before.size<1||before.size>MAX_BYTES)throw refusal();
  const bytes=Buffer.alloc(MAX_BYTES+1);let at=0,n;
  while(at<bytes.length&&(n=io.readSync(fd,bytes,at,bytes.length-at,null))>0)at+=n;
  const after=io.fstatSync(fd);
  if(at!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs||after.mode!==before.mode||after.uid!==before.uid||after.nlink!==1)throw refusal();
  try{return tokenBytes(bytes.subarray(0,at));}finally{bytes.fill(0);}
 }catch{throw refusal();}finally{if(fd!==undefined)io.closeSync(fd);if(dir!==undefined)io.closeSync(dir);}
}
function assertCredentialAbsent(value,secret){
 if(!secret)return;
 const literal=secret.toString(),encoded=secret.toString('base64');
 function inspect(v){
  if(typeof v==='string'){if(v.includes(literal)||v.includes(encoded))throw Object.assign(new Error('Repository authentication boundary refused credential-bearing output; no measurement was published.'),{code:'CLI_EXIT'});}
  else if(v&&typeof v==='object')for(const [k,x]of Object.entries(v)){inspect(k);if(k==='base64'&&typeof x==='string')inspect(Buffer.from(x,'base64').toString());inspect(x);}
 }
 inspect(value);
}
function cliEnvironment(secret){return {PATH:'/usr/bin:/bin',HOME:'/auth',CLAUDE_CODE_MAX_OUTPUT_TOKENS:'16384',CLAUDE_CODE_OAUTH_TOKEN:secret.toString(),DISABLE_TELEMETRY:'1',DISABLE_ERROR_REPORTING:'1'};}
function bootstrap(){
 let secret;
 try{
  if(process.argv[2]!=='--cli'||typeof process.execve!=='function')throw refusal();
  const bytes=Buffer.alloc(MAX_BYTES+1);let at=0,n;
  try{while(at<bytes.length&&(n=fs.readSync(3,bytes,at,bytes.length-at,null))>0)at+=n;}finally{fs.closeSync(3);}
  try{secret=tokenBytes(bytes.subarray(0,at));}finally{bytes.fill(0);}
  const env=cliEnvironment(secret);secret.fill(0);
  process.execve('/usr/bin/claude',['/usr/bin/claude',...process.argv.slice(3)],env);
 }catch{if(secret)secret.fill(0);process.stderr.write('Repository subscription bootstrap refused. No fallback.\n');process.exitCode=1;}
}
async function probeHook(){
 const cp=require('node:child_process');let input='';for await(const b of process.stdin){input+=b;if(Buffer.byteLength(input)>262144)throw Error('Probe hook input limit.');}
 const event=JSON.parse(input),key='CLAUDE_CODE_OAUTH_TOKEN';
 const record={event:event.hook_event_name,tool:event.tool_name,environment_absent:!Object.hasOwn(process.env,key),self_absent:!fs.readFileSync('/proc/self/environ').includes(Buffer.from(key+'='))};
 fs.appendFileSync('/control/auth-hook-evidence.jsonl',JSON.stringify(record)+'\n');
 if(!record.environment_absent||!record.self_absent)throw Error('Probe hook inherited authentication.');
 const result=cp.spawnSync('/usr/bin/node',['/control/repository-tool-hook.js','/control/config.json'],{input,env:{PATH:'/usr/bin:/bin',HOME:'/workspace'},encoding:'utf8',timeout:10000,maxBuffer:262144});
 if(result.status!==0)throw Error('Probe hook boundary refused.');process.stdout.write(result.stdout);
}
if(require.main===module){if(process.argv[2]==='--probe-hook')probeHook().catch(()=>{process.stderr.write('Authentication hook probe refused.\n');process.exitCode=2;});else bootstrap();}
module.exports={CLI_SHA256,assertCliAuthentication,readSubscriptionToken,assertCredentialAbsent,cliEnvironment};
