// SPDX-License-Identifier: Apache-2.0
'use strict';
// Complete bounded workspace bytes, separate from the judged text subset.
const fs=require('node:fs'),path=require('node:path');
const {canonicalize,sha256}=require('./canonical');
const {repositoryError:fail,safeName}=require('./repository');
const LIMITS=Object.freeze({bytes:4194304,encoded:8388608,entries:4096,depth:32,path_bytes:1024,wall_ms:30000});
function reject(message){throw fail('EXECUTION_SNAPSHOT',message);}
function name(p){if(typeof p!=='string'||Buffer.byteLength(p)>LIMITS.path_bytes||p.split('/').length>LIMITS.depth)reject('Snapshot path limit.');safeName(Buffer.from(p));return p;}
function mode(n){if(!Number.isInteger(n)||n<0||n>0o777)reject('Snapshot mode is unsupported.');return n;}
function sealWorkspaceSnapshot(doc){const {snapshot_hash,...body}=doc;return {...body,snapshot_hash:sha256(canonicalize(body))};}
function captureWorkspaceSnapshot(root,runtime){
 const began=Date.now(),entries=[];let total=0;
 const clock=()=>{if(Date.now()-began>LIMITS.wall_ms)reject('Snapshot traversal time limit.');};
 const base=fs.lstatSync(root);if(!base.isDirectory()||base.isSymbolicLink())reject('Snapshot root type.');
 function walk(rel){
  clock();const dir=fs.opendirSync(path.join(root,rel),{encoding:'buffer',bufferSize:16});
  try{let d;while((d=dir.readSync())){
   clock();if(entries.length>=LIMITS.entries)reject('Snapshot entry limit.');
   const p=name(rel?rel+'/'+safeName(d.name):safeName(d.name)),file=path.join(root,p),st=fs.lstatSync(file);
   const row={path:p,mode:mode(st.mode&0o7777)};
   if(st.isDirectory()){entries.push({...row,type:'directory'});walk(p);}
   else if(st.isFile()&&st.nlink===1){
    if((total+=st.size)>LIMITS.bytes)reject('Snapshot byte limit.');
    const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
    let bytes;try{
     const before=fs.fstatSync(fd);if(!before.isFile()||before.ino!==st.ino||before.dev!==st.dev||before.size!==st.size)reject('Snapshot file changed.');
     bytes=Buffer.alloc(st.size+1);let at=0,n;while((n=fs.readSync(fd,bytes,at,bytes.length-at,null))>0){clock();at+=n;if(at>st.size)reject('Snapshot file grew.');}
     const after=fs.fstatSync(fd);if(at!==st.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs)reject('Snapshot file changed.');bytes=bytes.subarray(0,at);
    }finally{fs.closeSync(fd);}
    entries.push({...row,type:'file',bytes:bytes.length,sha256:sha256(bytes),base64:bytes.toString('base64')});
   }else reject('Snapshot link or special file type.');
  }}finally{dir.closeSync();}
 }
 walk('');entries.sort((a,b)=>Buffer.compare(Buffer.from(a.path),Buffer.from(b.path)));
 return validateWorkspaceSnapshot(sealWorkspaceSnapshot({version:1,runtime_image_digest:runtime,root_mode:mode(base.mode&0o7777),bytes:total,entries}));
}
function validateWorkspaceSnapshot(doc,runtime){
 if(!doc||doc.version!==1||!Array.isArray(doc.entries)||doc.entries.length>LIMITS.entries||Buffer.byteLength(JSON.stringify(doc))>LIMITS.encoded)reject('Snapshot shape or size limit.');
 if(!/^[a-f0-9]{64}$/.test(doc.runtime_image_digest)||runtime&&doc.runtime_image_digest!==runtime)reject('Snapshot runtime differs.');
 if(doc.snapshot_hash!==sealWorkspaceSnapshot(doc).snapshot_hash)reject('Snapshot hash differs.');mode(doc.root_mode);
 let total=0,last='';const directories=new Set(['']);
 for(const r of doc.entries){
  name(r.path);mode(r.mode);if(r.path<=last)reject('Snapshot order or duplicate path.');last=r.path;
  const parent=r.path.includes('/')?r.path.slice(0,r.path.lastIndexOf('/')):'';
  if(!directories.has(parent))reject('Snapshot parent absent.');
  if(r.type==='directory')directories.add(r.path);
  else if(r.type==='file'){
   if(typeof r.base64!=='string'||r.base64.length>Math.ceil(LIMITS.bytes/3)*4)reject('Snapshot encoded byte limit.');
   const b=Buffer.from(r.base64,'base64');total+=b.length;
   if(total>LIMITS.bytes||b.toString('base64')!==r.base64||b.length!==r.bytes||sha256(b)!==r.sha256)reject('Snapshot byte hash or limit.');
  }else reject('Snapshot entry type.');
 }
 if(total!==doc.bytes)reject('Snapshot byte total differs.');return doc;
}
function restoreWorkspaceSnapshot(doc,root){
 validateWorkspaceSnapshot(doc);fs.mkdirSync(root,{mode:0o700});
 for(const r of doc.entries){const file=path.join(root,r.path);if(r.type==='directory')fs.mkdirSync(file,{mode:0o700});else{fs.writeFileSync(file,Buffer.from(r.base64,'base64'),{flag:'wx',mode:0o600});fs.chmodSync(file,r.mode);}}
 for(const r of [...doc.entries].reverse())if(r.type==='directory')fs.chmodSync(path.join(root,r.path),r.mode);
 fs.chmodSync(root,doc.root_mode);
}
function publishWorkspaceSnapshot(dir,doc){validateWorkspaceSnapshot(doc);const file=path.join(dir,'workspace-'+doc.snapshot_hash+'.json');require('./checkpoint').atomicFile(file,JSON.stringify(doc)+'\n');return file;}
function loadWorkspaceSnapshot(file,runtime){
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);let bytes;
 try{const st=fs.fstatSync(fd);if(!st.isFile()||st.size>LIMITS.encoded)reject('Snapshot input size limit.');bytes=Buffer.alloc(st.size+1);let at=0,n;while((n=fs.readSync(fd,bytes,at,bytes.length-at,null))>0){at+=n;if(at>st.size)reject('Snapshot grew.');}bytes=bytes.subarray(0,at);}finally{fs.closeSync(fd);}
 let doc;try{doc=JSON.parse(bytes.toString('utf8'));}catch{reject('Snapshot JSON invalid.');}validateWorkspaceSnapshot(doc,runtime);if(path.basename(file)!=='workspace-'+doc.snapshot_hash+'.json')reject('Snapshot filename hash differs.');return doc;
}
module.exports={LIMITS,sealWorkspaceSnapshot,captureWorkspaceSnapshot,validateWorkspaceSnapshot,restoreWorkspaceSnapshot,publishWorkspaceSnapshot,loadWorkspaceSnapshot};
