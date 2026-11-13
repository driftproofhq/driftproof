// SPDX-License-Identifier: Apache-2.0
'use strict';
const fs=require('node:fs'),path=require('node:path');
// This pinned CLI removes OAuth from Bash and hook environments before exec.
const CLI_SHA256='3920489a5109cff5786a1a392c25277408ff22bc796d5edb9c16a60e5a1718f0';
// A-490-32 (issue 786): the CLI each mode admits. The default mode keeps 2.1.287's pin, proved by spec
// 490's live probe. The tools-on mode admits 2.1.311 only with its own committed probe evidence for
// that exact binary (specs/786-tools-on-routers/probes/auth.cjs); before that evidence exists, only
// the supervisor's --auth-probe path, whose hook is the observer, may launch it.
const CLI_PINS=Object.freeze({
 repository:Object.freeze([{version:'2.1.287',cli_sha256:CLI_SHA256,basis:'spec 490 live probe'}]),
 'repository-tools-on':Object.freeze([{version:'2.1.311',cli_sha256:'86dc1fcc69498159eaf15f446613e847010f9036bfbbdffd4c49350be8489ada',evidence:'specs/786-tools-on-routers/evidence/auth-cli-2.1.311.json'}]),
});
const PIN_REFUSAL=(sha,mode)=>Object.assign(new Error('Repository CLI refused: the runtime image\'s Claude Code (sha256 '+sha.slice(0,12)+') is not admitted for the '+mode+' mode. No recorded authentication evidence names this binary.'),{code:'CLI_EXIT',reason:'cli_pin'});
const EVIDENCE_REFUSAL=(why)=>Object.assign(new Error('Repository CLI refused: its authentication evidence is '+why+'. Run the mode\'s authentication probe and commit its evidence.'),{code:'CLI_EXIT',reason:'cli_evidence'});
function fileSha256(file,limit){
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{const st=fs.fstatSync(fd);if(!st.isFile()||st.size>limit)return null;const hash=require('node:crypto').createHash('sha256'),buf=Buffer.alloc(1048576);let n;while((n=fs.readSync(fd,buf,0,buf.length,null)))hash.update(buf.subarray(0,n));return hash.digest('hex');}finally{fs.closeSync(fd);}
}
// The probe's evidence for one binary: present, passed, and naming that binary. Returns its sha256.
function verifyAuthEvidence(pin,{root=path.join(__dirname,'..')}={}){
 const file=path.join(root,pin.evidence);let bytes;
 try{const st=fs.lstatSync(file);if(!st.isFile()||st.size>65536)throw EVIDENCE_REFUSAL('not a regular file');bytes=fs.readFileSync(file);}catch(e){if(e.reason)throw e;throw EVIDENCE_REFUSAL('missing');}
 let doc;try{doc=JSON.parse(bytes.toString('utf8'));}catch{throw EVIDENCE_REFUSAL('unreadable');}
 const s=doc.subscription||{};
 if(doc.probe!=='issue 786 authentication'||doc.passed!==true||doc.cli_sha256!==pin.cli_sha256||doc.cli_version!==pin.version||doc.static?.oauth_in_scrub_list!==true||
  doc.marker_control?.boundary_passed!==true||doc.marker_control?.negative_control_saw_marker!==true||s.server_accepted!==true||s.bash_boundary_passed!==true||
  s.hooks_pretool_bash!==true||s.hooks_posttool_bash!==true||s.hooks_all_absent!==true||s.marker_absent!==true)throw EVIDENCE_REFUSAL('not a passed probe of this binary');
 return require('node:crypto').createHash('sha256').update(bytes).digest('hex');
}
function assertCliAuthentication(file,{mode='repository',probe=false}={}){
 const sha=fileSha256(file,536870912);if(!sha)throw PIN_REFUSAL('0'.repeat(12),mode);
 return admitCli(sha,{mode,probe});
}
// What a binary's sha256 admits in a mode: a pin, and, where the pin needs it, the binary's evidence.
function admitCli(sha,{mode='repository',probe=false,root}={}){
 const pin=(CLI_PINS[mode]||[]).find(p=>p.cli_sha256===sha);if(!pin)throw PIN_REFUSAL(sha,mode);
 if(!pin.evidence)return {pin,evidence_sha256:null};
 if(probe)return {pin,evidence_sha256:null,probe:true};
 return {pin,evidence_sha256:verifyAuthEvidence(pin,root?{root}:{})};
}
const DIRECTORY='/etc/driftproof',NAME='eval-oauth-token',MAX_BYTES=4096;
// The token file's refusal; the CLI's own refusals above name the binary instead.
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
module.exports={CLI_SHA256,CLI_PINS,verifyAuthEvidence,admitCli,assertCliAuthentication,readSubscriptionToken,assertCredentialAbsent,cliEnvironment};
