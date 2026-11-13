// SPDX-License-Identifier: Apache-2.0
'use strict';
// Issue 786. What the supervisor sets up for a tools-on draw beyond spec 490's: the world's starter,
// the draw's own loopback-only network namespace, the fixture servers in it (as nobody) and the tool
// session in it (as the eval user). Runs as root inside the draw's cgroup scope and private mount
// namespace; every process it starts stops with the scope.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const R=require('./repository');
const NOBODY=65534;
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const fail=(code,message)=>R.repositoryError(code,message);
// A world's starter: regular files and directories only, each file checked against the pinned list.
function copyWorldStarter(source,destination,starter,{uid,gid}={}){
  const want=new Map(starter.files.map(f=>[f.path,f]));
  fs.mkdirSync(destination,{recursive:true,mode:0o755});
  for(const f of starter.files){
    if(!/^[A-Za-z0-9._\/-]+$/.test(f.path)||f.path.split('/').some(p=>!p||p==='.'||p==='..'))throw fail('WORLD_BINDING','Starter path refused.');
    const from=path.join(source,f.path),st=fs.lstatSync(from);
    if(!st.isFile())throw fail('WORLD_BINDING','Starter entry is not a regular file.');
    const bytes=fs.readFileSync(from);if(sha(bytes)!==f.sha256||bytes.length!==f.bytes)throw fail('WORLD_BINDING','Starter byte differs: '+f.path);
    const to=path.join(destination,f.path);fs.mkdirSync(path.dirname(to),{recursive:true,mode:0o755});
    fs.writeFileSync(to,bytes,{flag:'wx',mode:f.mode});fs.chmodSync(to,f.mode);
  }
  (function walk(dir,rel){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=rel?rel+'/'+e.name:e.name;
    if(e.isDirectory())walk(path.join(dir,e.name),p);else if(!want.has(p))throw fail('WORLD_BINDING','Starter copy holds an unpinned file.');}})(destination,'');
  if(uid!==undefined)(function own(dir){fs.chownSync(dir,uid,gid);for(const e of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory())own(f);else fs.chownSync(f,uid,gid);}})(destination);
  return starter.files.map(f=>({path:f.path,mode:f.mode,bytes:f.bytes,sha256:f.sha256}));
}
function run(file,args,opts={}){
  const r=cp.spawnSync(file,args,{env:{PATH:'/usr/bin:/bin:/usr/sbin'},encoding:'utf8',timeout:30000,maxBuffer:1048576,...opts});
  if(r.error||r.status!==0)throw fail('CAPTURE_ISOLATION','Draw network step failed: '+path.basename(file)+'.');
  return r;
}
// Waits for a child's "ready" line; anything else, or silence past the limit, refuses the draw.
function ready(child,what,ms=15000){
  return new Promise((resolve,reject)=>{
    let out='';const timer=setTimeout(()=>reject(fail('CAPTURE_ENVIRONMENT',what+' did not start.')),ms);
    child.stdout.on('data',b=>{out+=b;if(out.includes('ready\n')){clearTimeout(timer);resolve();}});
    child.on('exit',()=>{clearTimeout(timer);reject(fail('CAPTURE_ENVIRONMENT',what+' stopped before it was ready.'));});
  });
}
const sandbox=(image)=>['/usr/bin/bwrap','--unshare-pid','--unshare-ipc','--unshare-uts','--die-with-parent','--new-session','--cap-drop','ALL','--ro-bind',image,'/','--proc','/proc','--dev','/dev','--tmpfs','/tmp'];
const drop=(uid,gid)=>['--reuid='+uid,'--regid='+gid,'--clear-groups','--no-new-privs','--inh-caps=-all','--ambient-caps=-all','--pdeathsig=KILL','--','/usr/bin/env','-i'];
// The draw's network: a namespace with only lo, bound to a file in the draw's own tmpfs.
// Every process this starts is returned with a stop that kills and reaps it. In the supervisor the
// draw's cgroup teardown also stops them; any other caller (the network probe) must call stop.
function stopChildren(children,ms=5000){
  return Promise.all(children.map(child=>new Promise(resolve=>{
    if(child.exitCode!==null||child.signalCode!==null){resolve();return;}
    const timer=setTimeout(resolve,ms);child.once('exit',()=>{clearTimeout(timer);resolve();});
    child.stdout?.destroy();child.stderr?.destroy();
    // nsenter and setpriv exec in place, so the child is bwrap itself; --die-with-parent ends its sandbox.
    try{child.kill('SIGKILL');}catch{}
  })));
}
async function startDrawNetwork({root,image,control,workspace,temp,uid,gid,world}){
  const children=[];
  try{return await startDrawNetworkInner({root,image,control,workspace,temp,uid,gid,world,children});}
  catch(e){await stopChildren(children);throw e;}
}
async function startDrawNetworkInner({root,image,control,workspace,temp,uid,gid,world,children}){
  const netns=path.join(root,'netns');fs.writeFileSync(netns,'',{mode:0o600});
  run('/usr/bin/unshare',['--net='+netns,'/usr/sbin/ip','link','set','lo','up']);
  const enter=['--net='+netns,'--','/usr/bin/setpriv'];
  let fixtureState=null;
  if(world.fixtures.length){
    fixtureState=path.join(root,'fixture-state');fs.mkdirSync(fixtureState,{mode:0o700});fs.chownSync(fixtureState,NOBODY,NOBODY);
    const config={state:'/fixture-state',servers:world.fixtures.map(f=>({name:f.name,kind:f.kind,port:f.port,root:f.root,files:f.files,...(f.tls?{tls:f.tls}:{})}))};
    const file=path.join(root,'fixture-config.json');fs.writeFileSync(file,JSON.stringify(config),{mode:0o444});
    const child=cp.spawn('/usr/bin/nsenter',[...enter,...drop(NOBODY,NOBODY),...sandbox(image),'--bind',fixtureState,'/fixture-state','--ro-bind',file,'/fixture-config.json',
      '--ro-bind',path.join(control,'repository-fixtures.js'),'/fixture-server.js','--clearenv','--setenv','PATH','/usr/bin:/bin','/usr/bin/node','/fixture-server.js','/fixture-config.json'],{env:{},stdio:['ignore','pipe','ignore']});
    children.push(child);await ready(child,'The fixture servers');
  }
  // The session's socket lives in its own directory, bound into the CLI's sandbox too.
  const sessionDir=path.join(root,'session');fs.mkdirSync(sessionDir,{mode:0o700});fs.chownSync(sessionDir,uid,gid);
  const sessionConfig=path.join(root,'session-config.json');
  fs.writeFileSync(sessionConfig,JSON.stringify({cwd:'/workspace',env:{HOME:'/workspace',PATH:'/usr/bin:/bin',...(world.env||{})}}),{mode:0o444});
  const child=cp.spawn('/usr/bin/nsenter',[...enter,...drop(uid,gid),'/usr/bin/prlimit','--cpu=900:900','--fsize=67108864:67108864','--nofile=256:256','--',...sandbox(image),
    '--bind',workspace,'/workspace','--bind',temp,'/tooltmp','--bind',sessionDir,'/session','--ro-bind',path.join(control,'repository-session.js'),'/session-runner.js',
    '--ro-bind',sessionConfig,'/session-config.json','--chdir','/workspace','--clearenv','--setenv','PATH','/usr/bin:/bin',
    '/usr/bin/node','/session-runner.js','--serve-path','/session/session.sock','/session-config.json'],{env:{},stdio:['ignore','pipe','ignore']});
  children.push(child);await ready(child,'The tool session');
  return {netns,sessionDir,fixtureState,socket:'/session/session.sock',children,stop:()=>stopChildren(children)};
}
// The fixtures' request record, read as root without following a link, after every process stopped.
function readOwned(file,limit){
  let fd;
  try{fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);}catch(e){if(e.code==='ENOENT')return null;throw fail('CAPTURE_COLLECTION','Fixture record is unsafe.');}
  try{const st=fs.fstatSync(fd);if(!st.isFile()||st.size>limit||st.uid!==NOBODY)throw fail('CAPTURE_COLLECTION','Fixture record size, type or owner.');
    const b=Buffer.alloc(st.size);fs.readSync(fd,b,0,st.size,0);return b.toString('utf8');}finally{fs.closeSync(fd);}
}
function readFixtureState(dir,limit=1048576){
  if(!dir)return {requests:[]};
  const text=readOwned(path.join(dir,'requests.jsonl'),limit);
  const requests=text===null?[]:text.split('\n').filter(Boolean).map(l=>{const r=JSON.parse(l);return {server:String(r.server),method:String(r.method),path:String(r.path).slice(0,512),status:Number(r.status)};});
  // The fixture app's own state, and the pages it served, read from its request record.
  const appText=readOwned(path.join(dir,'app.json'),65536),appRequests=requests.filter(r=>r.server==='app');
  if(appText===null&&!appRequests.length)return {requests};
  const saved=appText===null?{submissions:[],state:{}}:JSON.parse(appText);
  return {requests,app:{submissions:Array.isArray(saved.submissions)?saved.submissions:[],state:saved.state&&typeof saved.state==='object'?saved.state:{},
    visits:[...new Set(appRequests.filter(r=>r.method==='GET'&&r.status===200).map(r=>r.path.split('?')[0]))]}};
}
module.exports={NOBODY,copyWorldStarter,startDrawNetwork,stopChildren,readFixtureState};
