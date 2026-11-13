// SPDX-License-Identifier: Apache-2.0
'use strict';
// Issue 786. The tools-on mode's tool session: one sandbox for the whole draw, inside the draw's own
// loopback-only network namespace, so a browser or a server a command starts outlives that command
// but not the draw (spec 786 TBD-3, the controller's answer). The supervisor owns the listening
// socket and passes it in; a Bash call reaches the session through the client, which the hook runs.
//   server: node repository-session.js --serve <config.json>     (listens on fd 3)
//   client: node repository-session.js --client <socket> <base64 command> <timeout ms>
const fs=require('node:fs'),net=require('node:net'),cp=require('node:child_process');
const LIMITS=Object.freeze({command_bytes:65536,output_bytes:1048576,timeout_ms:120000,frame_bytes:2*1048576+65536});
function cap(chunks,size){const b=Buffer.concat(chunks);return b.length>size?b.subarray(0,size):b;}
// One command, run by bash inside the session. Its process group is killed at the timeout; a process
// it detached (setsid) keeps running until the draw ends.
function runCommand(config,command,timeoutMs){
  return new Promise((resolve)=>{
    const child=cp.spawn('/usr/bin/prlimit',['--cpu=120:120','--fsize=67108864:67108864','--nofile=128:128','--','/bin/bash','--noprofile','--norc','-c',command],
      {cwd:config.cwd,env:{...config.env},detached:true,stdio:['ignore','pipe','pipe']});
    const out=[],err=[];let o=0,e=0,timedOut=false,done=false;
    child.stdout.on('data',b=>{if(o<LIMITS.output_bytes)out.push(b);o+=b.length;});
    child.stderr.on('data',b=>{if(e<LIMITS.output_bytes)err.push(b);e+=b.length;});
    const timer=setTimeout(()=>{timedOut=true;try{process.kill(-child.pid,'SIGKILL');}catch{}},timeoutMs);
    // A daemon may keep the pipes open, so the command ends when bash exits, not when the pipes close.
    child.on('exit',(code,signal)=>{if(done)return;done=true;clearTimeout(timer);setImmediate(()=>resolve({code,signal,timed_out:timedOut,
      stdout:cap(out,LIMITS.output_bytes).toString('base64'),stderr:cap(err,LIMITS.output_bytes).toString('base64'),truncated:o>LIMITS.output_bytes||e>LIMITS.output_bytes}));});
    child.on('error',()=>{if(done)return;done=true;clearTimeout(timer);resolve({code:127,signal:null,timed_out:false,stdout:'',stderr:Buffer.from('session could not start the command\n').toString('base64'),truncated:false});});
  });
}
// Commands run one at a time, in arrival order, as the hook's tool lease already serializes them.
function serve(config,{fd=3,listen}={}){
  let queue=Promise.resolve();
  const server=net.createServer(sock=>{
    let buf=Buffer.alloc(0);
    sock.on('data',chunk=>{
      buf=Buffer.concat([buf,chunk]);if(buf.length>LIMITS.frame_bytes){sock.destroy();return;}
      const end=buf.indexOf(10);if(end<0)return;
      let req;try{req=JSON.parse(buf.subarray(0,end).toString('utf8'));}catch{sock.destroy();return;}
      const command=typeof req.command==='string'?req.command:null,timeout=Number.isInteger(req.timeout_ms)?Math.min(Math.max(req.timeout_ms,1000),LIMITS.timeout_ms):LIMITS.timeout_ms;
      if(command===null||Buffer.byteLength(command)>LIMITS.command_bytes){sock.end(JSON.stringify({code:2,signal:null,timed_out:false,stdout:'',stderr:Buffer.from('invalid session request\n').toString('base64'),truncated:false})+'\n');return;}
      queue=queue.then(()=>runCommand(config,command,timeout)).then(r=>{sock.end(JSON.stringify(r)+'\n');});
    });
    sock.on('error',()=>{});
  });
  if(listen)server.listen(listen);else server.listen({fd});
  return server;
}
function client(socket,encoded,timeoutMs){
  return new Promise((resolve)=>{
    const sock=net.connect(socket);let buf=Buffer.alloc(0);
    sock.on('connect',()=>sock.write(JSON.stringify({command:Buffer.from(encoded,'base64').toString('utf8'),timeout_ms:Number(timeoutMs)})+'\n'));
    sock.on('data',b=>{buf=Buffer.concat([buf,b]);if(buf.length>LIMITS.frame_bytes)sock.destroy();});
    sock.on('error',()=>resolve({code:126,stderr:'The draw\'s tool session is unavailable.\n',stdout:''}));
    sock.on('close',()=>{
      try{const r=JSON.parse(buf.toString('utf8'));resolve({code:r.timed_out?124:(Number.isInteger(r.code)?r.code:1),stdout:Buffer.from(r.stdout||'','base64'),stderr:Buffer.from(r.stderr||'','base64')});}
      catch{resolve({code:126,stderr:'The draw\'s tool session returned no result.\n',stdout:''});}
    });
  });
}
function clientCommand(socket,command,timeoutMs=LIMITS.timeout_ms){
  const q=s=>"'"+String(s).replace(/'/g,"'\\''")+"'";
  return ['/usr/bin/node','/control/repository-session.js','--client',socket,Buffer.from(command,'utf8').toString('base64'),String(timeoutMs)].map(q).join(' ');
}
if(require.main===module){
  const mode=process.argv[2];
  if(mode==='--serve'){const config=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));serve(config);}
  else if(mode==='--serve-path'){
    // The socket's directory is the eval user's, mode 0700: only the CLI's hook client and the
    // session's own commands reach it.
    const config=JSON.parse(fs.readFileSync(process.argv[4],'utf8'));
    const server=serve(config,{listen:process.argv[3]});server.on('listening',()=>{fs.chmodSync(process.argv[3],0o600);process.stdout.write('ready\n');});
  }
  else if(mode==='--client')client(process.argv[3],process.argv[4],process.argv[5]).then(r=>{process.stdout.write(r.stdout);process.stderr.write(r.stderr);process.exitCode=r.code;});
  else process.exitCode=2;
}
module.exports={LIMITS,runCommand,serve,client,clientCommand};
