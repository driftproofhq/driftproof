// SPDX-License-Identifier: Apache-2.0
'use strict';
// Issue 490. Bounded, byte-preserving repository evidence.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sha = (x) => crypto.createHash('sha256').update(x).digest('hex');
const fail = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra });
const TOOLS = Object.freeze(['Read', 'Glob', 'Grep', 'Write', 'Edit', 'Bash']);
const LIMITS = Object.freeze({ max_output_tokens: 16384, max_turns: 32, timeout_ms: 900000 });
const RESOURCES = Object.freeze({ memory: 536870912, processes: 64, disk_bytes: 268435456, inodes: 4096,
  stream_bytes: 8388608, event_bytes: 262144, event_count: 4096, diagnostic_bytes: 65536,
  traversal_entries: 4096, path_depth: 32, path_bytes: 1024, metadata_records: 1024,
  metadata_bytes: 1048576, collection_timeout: 30000 });
const STARTER = path.join(__dirname, '../specs/490-repository-capture/starter');
const safeName = (buf) => {
  if (!/^[A-Za-z0-9._/-]+$/.test(buf.toString('latin1')) ||
    buf.toString('latin1').split('/').some((x) => !x || x === '.' || x === '..')) {
    throw fail('CAPTURE_FILENAME', 'Unsupported filename; see path_bytes_hex.', { path_bytes_hex: buf.toString('hex').slice(0, 2048) });
  }
  return buf.toString('ascii');
};
function entries(root, starter = false) {
  const found = [],directories = [];
  const began = Date.now();
  let visited = 0;
  function walk(rel, depth) {
    if (depth > (starter ? 2 : RESOURCES.path_depth)) throw fail(starter ? 'STARTER_LIMIT' : 'CAPTURE_RESOURCE_LIMIT', 'Path depth limit.', { resource_kind: 'path_depth' });
    const dir = fs.opendirSync(path.join(root, rel), { encoding: 'buffer', bufferSize: 16 });
    try {
      for (let entry; (entry = dir.readSync());) {
        if (++visited > (starter ? 66 : RESOURCES.traversal_entries) || Date.now() - began > 30000)
          throw fail(starter ? 'STARTER_LIMIT' : 'CAPTURE_RESOURCE_LIMIT', 'Traversal limit.', { resource_kind: 'traversal_entries' });
        const raw = Buffer.concat([Buffer.from(rel ? rel + '/' : ''), Buffer.from(entry.name)]);
        if (raw.length > (starter ? 256 : RESOURCES.path_bytes)) throw fail(starter ? 'STARTER_LIMIT' : 'CAPTURE_RESOURCE_LIMIT', 'Path size limit.', { resource_kind: 'path_bytes' });
        const name = safeName(raw), file = path.join(root, name), st = fs.lstatSync(file);
        if (st.isDirectory()) {
          if (starter && (!['src', 'test'].includes(name) || (st.mode & 511) !== 493)) throw fail('STARTER_DIRECTORIES', 'Noncanonical starter directory.');
          directories.push({path:name,st,type:'directory'});
          walk(name, depth + 1);
        } else found.push({ path: name, st, type: st.isFile() ? 'file' : st.isSymbolicLink() ? 'symlink' : 'special' });
      }
    } finally { dir.closeSync(); }
  }
  if (starter) {
    if ((fs.lstatSync(root).mode & 511) !== 493) throw fail('STARTER_DIRECTORIES', 'Noncanonical root mode.');
    for (const name of ['src', 'test']) {
      const st = fs.lstatSync(path.join(root, name));
      if (!st.isDirectory() || st.isSymbolicLink() || (st.mode & 511) !== 493) throw fail('STARTER_DIRECTORIES', 'Noncanonical starter directory.');
    }
  }
  walk('', 0);
  found.sort((a,b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  Object.defineProperty(found,'directories',{value:directories});
  return found;
}
function readFile(root, row, cap) {
  if (row.st.size > cap) throw fail('STARTER_LIMIT', 'File size limit.');
  const fd = fs.openSync(path.join(root, row.path), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.ino !== row.st.ino || st.dev !== row.st.dev || st.size !== row.st.size) throw fail('CAPTURE_RACE', 'File changed during collection.');
    const buf = Buffer.alloc(st.size + 1);
    let total = 0, n;
    while ((n = fs.readSync(fd, buf, total, buf.length - total, null)) > 0) {
      total += n; if (total > st.size) throw fail('CAPTURE_RACE', 'File grew during collection.');
    }
    if (total !== st.size) throw fail('CAPTURE_RACE', 'File changed during collection.');
    return buf.subarray(0, total);
  } finally { fs.closeSync(fd); }
}
function repositoryManifest(root) {
  let total = 0;
  const rows = entries(root, true);
  if (rows.length > 64) throw fail('STARTER_LIMIT', 'Starter entry limit.');
  const files = rows.map((row) => {
    if (row.type !== 'file') throw fail('STARTER_TYPE', 'Starter must contain regular files; no symlink.');
    if ((total += row.st.size) > 1048576) throw fail('STARTER_LIMIT', 'Starter byte limit.');
    const buf = readFile(root, row, 65536);
    return { path: row.path, mode: row.st.mode & 511, bytes: buf.length, sha256: sha(buf) };
  });
  return { files, sha256: sha(JSON.stringify(files.map(f => [f.path, f.mode, f.bytes, f.sha256]))) };
}
function copyRepositoryWorkspace(source, destination, manifest) {
  if (JSON.stringify(repositoryManifest(source)) !== JSON.stringify(manifest)) throw fail('STARTER_MISMATCH', 'Starter manifest mismatch.');
  fs.mkdirSync(destination, { recursive: true, mode: 493 }); fs.chmodSync(destination, 493);
  for (const dir of ['src','test']) { fs.mkdirSync(path.join(destination,dir), { mode:493 }); fs.chmodSync(path.join(destination,dir),493); }
  for (const row of manifest.files) {
    const from = path.join(source,row.path), to = path.join(destination,row.path);
    fs.copyFileSync(from,to,fs.constants.COPYFILE_EXCL); fs.chmodSync(to,row.mode);
    const a=fs.statSync(from),b=fs.statSync(to);
    if (a.dev===b.dev && a.ino===b.ino) throw fail('STARTER_COPY','Copy shares writable inode.');
  }
  if (JSON.stringify(repositoryManifest(destination)) !== JSON.stringify(manifest)) throw fail('STARTER_COPY','Copy identity mismatch.');
}
function collectRepositoryWorkspace(root, before) {
  const files = [];
  function limit(kind) {
    return fail('CAPTURE_RESOURCE_LIMIT','Bounded repository collection stopped.',{
      resource_kind:kind, capture:{files,collection:{enumeration_complete:false,total:null}} });
  }
  let after;
  try { after = entries(root); } catch(e) {
    if(e.code === 'CAPTURE_RESOURCE_LIMIT') throw limit(e.resource_kind);
    throw e;
  }
  const old = new Map(before.files.map(f=>[f.path,f]));
  const names = new Map([...after,...after.directories.filter(f=>old.has(f.path))].map(f=>[f.path,f]));
  let bytes=0, admitted=0, meta=0;
  for(const name of [...new Set([...old.keys(),...names.keys()])].sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b)))) {
    const a=old.get(name),b=names.get(name);
    const excluded=/(^|\/)(node_modules|\.git|\.claude|__pycache__)(\/|$)/.test(name);
    let content=null;
    if(b?.type==='file' && b.st.size<=65536 && !excluded) content=readFile(root,b,65536);
    if(a && b?.type==='file' && content && a.sha256===sha(content) && a.mode===(b.st.mode&511)) continue;
    const change=!b?'deleted':!a?'added':b.type!=='file'?'type_changed':content && a.sha256===sha(content)?'mode_changed':'modified';
    const row={path:name,change,before_type:a?'file':'absent',after_type:b?.type||'absent',
      before_mode:a?.mode??null,after_mode:b?(b.st.mode&511):null,bytes:b?.type==='file'?b.st.size:0,included:false};
    if(!b) row.why='deleted';
    else if(excluded) row.why='excluded: dependency path';
    else if(b.type!=='file') row.why='not captured: '+b.type;
    else if(b.st.size>65536) row.why='over the 65536-byte file cap; not read';
    else if(content.includes(0) || !Buffer.from(content.toString('utf8')).equals(content)) row.why='not text: binary or invalid UTF-8';
    else if(admitted>=50 || bytes+content.length>262144) row.why='over the workspace content cap';
    else { row.included=true;row.content=content.toString('utf8');row.sha256=sha(content);admitted++;bytes+=content.length; }
    if(files.length>=1024) throw limit('metadata_records');
    meta+=Buffer.byteLength(JSON.stringify({...row,content:undefined}));
    if(meta>1048576) throw limit('metadata_bytes');
    files.push(row);
  }
  return files;
}
function fakeToolCallEnding(text) {
  const s=String(text||'').trim();
  return /<(?:invoke|tool_call|function_call)\b[\s\S]*<\/(?:invoke|tool_call|function_call)>$/.test(s) ||
    /\{\s*"(?:tool|tool_call|name)"\s*:[\s\S]*\}$/.test(s);
}
function policy({timeoutMs=LIMITS.timeout_ms}={}) {
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>2147478647)throw fail('CAPTURE_LIMITS','Repository timeout must be a positive supported millisecond limit.');
  const manifest=repositoryManifest(STARTER);
  const pin=JSON.parse(fs.readFileSync(path.join(STARTER,'../starter-manifest.json'),'utf8'));
  if(JSON.stringify(manifest)!==JSON.stringify(pin)) throw fail('STARTER_MISMATCH','Committed starter pin differs.');
  const contract_hash=sha(['repository.js','repository-execution.js','repository-supervisor.js','workspace-snapshot.js','hidden-execution.js','hidden-supervisor.js','repository-tool-hook.js','checkpoint.js','capture.js'].map(f=>f+' '+sha(fs.readFileSync(path.join(__dirname,f)))).join('\n'));
  return { mode:'repository',contract_hash,starter_hash:manifest.sha256,starter_manifest:manifest,tools:TOOLS,limits:{...LIMITS,timeout_ms:timeoutMs},
    resources:RESOURCES,isolation:{tool_network:'none',credentials:'unreachable',allow_unsandboxed:false,required:true} };
}
module.exports={TOOLS,LIMITS,RESOURCES,STARTER,repositoryDigest:sha,repositoryError:fail,safeName,repositoryManifest,copyRepositoryWorkspace,collectRepositoryWorkspace,fakeToolCallEnding,policy};
