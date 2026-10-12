#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Public GitHub observations, not evidence of retained behavior or historical shipment.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
export const QUERY = 'author:mavericksea-ai is:pr is:merged is:public -org:driftproofhq -user:mavericksea-ai';
export const OPEN_QUERY = QUERY.replace('is:merged', 'is:open');
const API = 'https://api.github.com';
export const LIMITS = Object.freeze({ requests: 512, pages: 20, responseBytes: 2 * 1024 * 1024, totalBytes: 32 * 1024 * 1024, requestMs: 15000, totalMs: 120000 });
const sha = b => createHash('sha256').update(b).digest('hex');
const need = (ok, reason) => { if (!ok) throw new Error(reason); };
const validTime = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(s) && Number.isFinite(Date.parse(s));
const validSha = s => typeof s === 'string' && /^[0-9a-f]{40}$/.test(s);
const byteOrder = (a,b) => Buffer.compare(Buffer.from(String(a)),Buffer.from(String(b)));
const searchUrl = (query,page=1) => API + '/search/issues?q=' + encodeURIComponent(query) + '&per_page=100&page=' + page;
const repoPath = repo => '/repos/' + repo;
const prUrl = (repo,n) => 'https://github.com/' + repo + '/pull/' + n;
const encodeTag = tag => encodeURIComponent(tag).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const tagUrl = (repo,tag) => 'https://github.com/' + repo + '/releases/tag/' + encodeTag(tag);
function nextPage(response,first,seen) {
  const link=response.headers?.link || '';
  need(typeof link === 'string','malformed pagination');
  const next=[...link.matchAll(/<([^>]+)>;\s*rel="next"/g)];
  need(next.length <= 1,'malformed pagination');
  if (!next.length) return null;
  const url=next[0][1];
  need(!seen.has(url),'pagination cycle');
  let u; try { u=new URL(url); } catch { throw Error('pagination endpoint'); }
  const f=new URL(first);
  const expected=new URL(first);expected.searchParams.set('page',u.searchParams.get('page'));
  need(u.origin === API && !u.username && !u.password && !u.hash && u.pathname === f.pathname && /^\d+$/.test(u.searchParams.get('page') || '') && Number(u.searchParams.get('page'))>0 && [...u.searchParams].length === [...expected.searchParams].length && [...expected.searchParams].every(([k,v])=>u.searchParams.getAll(k).length===1&&u.searchParams.get(k)===v),'pagination endpoint');
  return url;
}
function pages(get,first,search=false) {
  const all=[];const seen=new Set();let url=first;let total;
  while(url) {
    need(seen.size < LIMITS.pages,'page budget');need(!seen.has(url),'pagination cycle');seen.add(url);
    const response=get(url);const b=response.body;
    if(search) {
      need(b && Array.isArray(b.items) && Number.isSafeInteger(b.total_count) && b.total_count>=0 && typeof b.incomplete_results === 'boolean','malformed search');
      need(!b.incomplete_results,'incomplete search');
      need(b.total_count <= 1000,'search cap'); // check: CAP
      if(total === undefined)total=b.total_count;else need(total===b.total_count,'inconsistent total');
      all.push(...b.items);
    } else {need(Array.isArray(b),'malformed releases');all.push(...b);}
    url=nextPage(response,first,seen);
  }
  if(search) {
    const ids=all.map(p=>p.html_url);need(new Set(ids).size===ids.length,'duplicate PR');
    need(all.length === total,'search total mismatch');
  }
  return all;
}
function identity(item) {
  const m=/^https:\/\/api\.github\.com\/repos\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)$/.exec(item.repository_url || '');
  need(m && Number.isSafeInteger(item.number) && item.number>0 && item.html_url===prUrl(m[1],item.number) && item.pull_request?.url===API+repoPath(m[1])+'/pulls/'+item.number,'PR identity');
  const repo=m[1];
  need(!['driftproofhq','mavericksea-ai'].includes(repo.split('/')[0].toLowerCase()),'excluded repository'); // check: EXCLUDED
  return repo;
}
function releaseIdentity(r,repo) {
  try { const u=new URL(r.html_url);const prefix='/'+repo+'/releases/tag/';return u.origin==='https://github.com' && !u.username && !u.password && !u.hash && !u.search && u.pathname.startsWith(prefix) && decodeURIComponent(u.pathname.slice(prefix.length))===r.tag_name; } catch {return false;}
}
function candidate(list,repo,mergedAt) {
  const seen=new Set();
  for(const r of list) {
    need(r && typeof r.tag_name==='string' && r.tag_name.length>0 && r.tag_name.length<=512 && releaseIdentity(r,repo) && (typeof r.id==='number'||typeof r.id==='string') && !seen.has(r.id),'release identity: '+repo+' '+r?.html_url);seen.add(r.id);
    need(typeof r.draft==='boolean' && typeof r.prerelease==='boolean' && typeof r.body==='string' && (r.body_omitted===undefined || (r.body_omitted===true && r.body==='')),'malformed release');
    if(!r.draft)need(validTime(r.published_at),'publication time');
  }
  return list.filter(r=>!r.draft && Date.parse(r.published_at)>Date.parse(mergedAt)).sort((a,b)=>Date.parse(a.published_at)-Date.parse(b.published_at)||byteOrder(a.tag_name,b.tag_name)||byteOrder(a.id,b.id))[0] || null;
}
function outsideHidden(body) {
  const spans=[];let from=0;
  const openings=/<!--|<(script|style)\b[^>]*>/gi;
  for(let token; (token=openings.exec(body));) {
    spans.push(body.slice(from,token.index));
    let end;
    if(token[0]==='<!--') {
      const close=body.indexOf('-->',openings.lastIndex);end=close<0?body.length:close+3;
    } else {
      const closing=new RegExp('</'+token[1]+'\\s*>','gi');closing.lastIndex=openings.lastIndex;
      const close=closing.exec(body);end=close?closing.lastIndex:body.length;
    }
    from=end;openings.lastIndex=end;
  }
  spans.push(body.slice(from));
  // A separator keeps delimiter fragments on opposite sides from becoming new markup.
  return spans.join(' ');
}
export function mentions(body,repo,n) {
  let text=outsideHidden(body);
  // A foreign Markdown link labelled #n is not a local PR reference.
  text=text.replace(/\[([^\]]*)\]\((https:\/\/github\.com\/[^\s)]+)\)/g,(_m,label,url)=>url===prUrl(repo,n)?url:(url.startsWith('https://github.com/')?'':label));
  const urls=[...text.matchAll(/https:\/\/github\.com\/[^\s<>"')]+/g)].map(m=>m[0].replace(/[.,;:!?]+$/,''));
  if(urls.includes(prUrl(repo,n)))return true;
  text=text.replace(/https?:\/\/[^\s<>]+/g,'').replace(/<[^>]*>/g,' ');
  return new RegExp('(^|[^A-Za-z0-9_/#])#'+n+'(?![A-Za-z0-9_])').test(text);
}
function derive(get) {
  const merged=pages(get,searchUrl(QUERY),true);const open=pages(get,searchUrl(OPEN_QUERY),true);
  for(const p of open) {identity(p);need(p.state==='open' && p.pull_request.merged_at===null,'open search identity');need(p.user?.login==='mavericksea-ai','wrong author');}
  const releases=new Map();const pulls=[];
  for(const item of merged) {
    const repo=identity(item);const detail=get(API+repoPath(repo)+'/pulls/'+item.number).body;
    need(detail?.number===item.number && detail.html_url===prUrl(repo,item.number) && detail.base?.repo?.full_name===repo && detail.base.repo.html_url==='https://github.com/'+repo,'PR identity');
    need(detail.base.repo.private===false,'private repository');
    need(detail.user?.login==='mavericksea-ai' && item.user?.login==='mavericksea-ai','wrong author'); // check: AUTHOR
    need(detail.merged===true && detail.state==='closed' && item.state==='closed','not merged');
    need(validTime(detail.merged_at) && validSha(detail.merge_commit_sha),'merge time');
    need(detail.merged_at===item.pull_request.merged_at && detail.title===item.title,'search/detail disagreement');
    if(!releases.has(repo))releases.set(repo,pages(get,API+(Number.isSafeInteger(detail.base.repo.id)?'/repositories/'+detail.base.repo.id:repoPath(repo))+'/releases?per_page=100&page=1'));
    const r=candidate(releases.get(repo),repo,detail.merged_at);let release=null;
    if(r) {
      need(r.body_omitted!==true,'selected release notes missing');
      const resolved=get(API+repoPath(repo)+'/commits/'+encodeTag(r.tag_name)).body.sha;
      need(validSha(resolved),'tag resolution');
      const comparison=get(API+repoPath(repo)+'/compare/'+detail.merge_commit_sha+'...'+resolved).body;
      need(comparison?.base_commit?.sha===detail.merge_commit_sha && (!comparison.head_commit || comparison.head_commit.sha===resolved),'compare identity');
      need(['ahead','identical'].includes(comparison.status) && comparison.behind_by===0 && comparison.merge_base_commit?.sha===detail.merge_commit_sha && Number.isSafeInteger(comparison.ahead_by) && comparison.ahead_by>=0,'containment');
      release={tag:r.tag_name,url:tagUrl(repo,r.tag_name),published_at:r.published_at,resolved_commit:resolved,credited:mentions(r.body,repo,item.number)};
    }
    pulls.push({repo,number:item.number,url:item.html_url,title:detail.title,merged_at:detail.merged_at,merge_commit_sha:detail.merge_commit_sha,release});
  }
  pulls.sort((a,b)=>byteOrder(a.repo,b.repo)||a.number-b.number);
  return pulls; // derivation result
}
export function deriveUpstream(responses) {
  need(Array.isArray(responses),'malformed responses');const byUrl=new Map();
  for(const r of responses) {need(r && typeof r.url==='string' && !byUrl.has(r.url),'duplicate response');byUrl.set(r.url,r);}
  let count=0;
  return derive(url=>{need(++count<=LIMITS.requests,'request budget');const r=byUrl.get(url);if(!r) {const e=Error('fixture response missing: '+url);e.requestUrl=url;throw e;}need(r.status===200,'HTTP '+r.status);need(Buffer.byteLength(JSON.stringify(r.body))<=LIMITS.responseBytes,'response byte budget');return r;});
}
// Only public fields used by the claim are retained. Contact text is not part of the claim.
const cleanText=s=>typeof s==='string'?s.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[contact omitted]').replace(/\/(?:home|Users)\/[^/\s]+/g,'~'):s;
const user=u=>({login:u?.login});
function projectBody(url,b) {
  if(url.includes('/search/issues?'))return {total_count:b.total_count,incomplete_results:b.incomplete_results,items:b.items?.map(p=>({number:p.number,title:cleanText(p.title),html_url:p.html_url,user:user(p.user),state:p.state,repository_url:p.repository_url,pull_request:{url:p.pull_request?.url,merged_at:p.pull_request?.merged_at}}))};
  if(/\/pulls\/\d+$/.test(url))return {number:b.number,title:cleanText(b.title),html_url:b.html_url,user:user(b.user),state:b.state,merged:b.merged,merged_at:b.merged_at,merge_commit_sha:b.merge_commit_sha,base:{repo:{...(Number.isSafeInteger(b.base?.repo?.id)?{id:b.base.repo.id}:{}),full_name:b.base?.repo?.full_name,private:b.base?.repo?.private,html_url:b.base?.repo?.html_url}}};
  if(url.includes('/releases?'))return Array.isArray(b)?b.map(r=>({id:r.id,tag_name:r.tag_name,html_url:r.html_url,published_at:r.published_at,created_at:r.created_at,body:cleanText(r.body || ''),draft:r.draft,prerelease:r.prerelease})):b;
  if(url.includes('/commits/'))return {sha:b.sha};
  if(url.includes('/compare/'))return {status:b.status,ahead_by:b.ahead_by,behind_by:b.behind_by,...(b.head_commit?{head_commit:{sha:b.head_commit.sha}}:{}),base_commit:{sha:b.base_commit?.sha},merge_base_commit:{sha:b.merge_base_commit?.sha}};
  throw Error('unexpected endpoint');
}
export async function refreshUpstream({out,fixture,readAt=new Date().toISOString(),fetch:transport=globalThis.fetch,limits={}}={}) {
  out=path.resolve(out || fileURLToPath(new URL('../docs/data/upstream.json',import.meta.url)));
  need(validTime(readAt),'observation time');
  const budgets={...LIMITS};for(const [k,v] of Object.entries(limits)){need(['requestMs','totalMs'].includes(k)&&Number.isFinite(v)&&v>0&&v<=LIMITS[k],'invalid test budget');budgets[k]=v;}
  const started=Date.now();let count=0,bytes=0;const responses=[];let fixtures=null;
  if(fixture) {need(fs.statSync(fixture).size<=budgets.totalBytes,'fixture byte budget');fixtures=JSON.parse(fs.readFileSync(fixture,'utf8'));need(Array.isArray(fixtures),'malformed fixture');need(new Set(fixtures.map(r=>r.url)).size===fixtures.length,'duplicate response');}
  async function load(url) {
    need(++count<=budgets.requests,'request budget');need(Date.now()-started<budgets.totalMs,'elapsed time budget');
    let r;
    if(fixtures) {r=fixtures.find(r=>r.url===url);need(r,'fixture response missing: '+url);need(Buffer.byteLength(JSON.stringify(r.body))<=budgets.responseBytes,'response byte budget');}
    else {
      const controller=new AbortController();const remaining=budgets.totalMs-(Date.now()-started);const ms=Math.min(budgets.requestMs,remaining);let timer;
      try {
        r=await Promise.race([(async()=>{
          const headers={accept:'application/vnd.github+json','x-github-api-version':'2022-11-28','user-agent':'driftproof-upstream'};
          if(process.env.GITHUB_TOKEN)headers.authorization='Bearer '+process.env.GITHUB_TOKEN;
          const response=await transport(url,{headers,signal:controller.signal,redirect:'error'});
          need(response.status===200,'HTTP '+response.status);
          const chunks=[];let size=0;const reader=response.body.getReader();
          while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;need(size<=budgets.responseBytes,'response byte budget');chunks.push(value);}
          return {url,status:response.status,headers:response.headers.get('link')?{link:response.headers.get('link')}:{},body:JSON.parse(Buffer.concat(chunks).toString('utf8'))};
        })(),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error(remaining<=budgets.requestMs?'elapsed time budget':'request time budget'));},ms);})]);
      } finally {clearTimeout(timer);controller.abort();}
    }
    need(r.status===200,'HTTP '+r.status);
    const recorded={url,status:r.status,headers:r.headers?.link?{link:r.headers.link}:{},body:fixtures?r.body:projectBody(url,r.body)};
    bytes+=Buffer.byteLength(JSON.stringify(recorded));need(bytes<=budgets.totalBytes,'response total byte budget');responses.push(recorded);
  }
  let pulls;
  while(true) {try {pulls=deriveUpstream(responses);break;}catch(e){if(!e.requestUrl)throw e;await load(e.requestUrl);}}
  need(Date.now()-started<budgets.totalMs,'elapsed time budget');
  // Preserve fixture ordering while recording only requests actually used.
  const ordered=fixtures?fixtures.filter(r=>responses.some(x=>x.url===r.url)).map(r=>responses.find(x=>x.url===r.url)):responses;
  return installSnapshot(out,ordered,readAt,pulls,started+budgets.totalMs);
}
function projectEvidence(responses,pulls) {
  const byRepo=new Map();
  for(const response of responses.filter(r=>r.url.includes('/releases?')))for(const r of response.body) {
    const repo=new URL(r.html_url).pathname.split('/').slice(1,3).join('/');
    if(!byRepo.has(repo))byRepo.set(repo,[]);byRepo.get(repo).push(r);
  }
  const selected=new Set(pulls.filter(p=>p.release).map(p=>candidate(byRepo.get(p.repo),p.repo,p.merged_at)));
  return responses.map(response=>{
    if(!response.url.includes('/releases?'))return response;
    return {...response,body:response.body.map(r=>{
      if(selected.has(r))return r;
      return {...r,body:'',body_omitted:true};
    })};
  });
}
function installSnapshot(out,responses,readAt,pulls,deadline=Date.now()+LIMITS.totalMs) {
  const projected=projectEvidence(responses,pulls);
  need(isDeepStrictEqual(deriveUpstream(projected),pulls),'projection changed row facts');
  const evidenceBytes=Buffer.from(JSON.stringify({read_at:readAt,query:QUERY,open_query:OPEN_QUERY,responses:projected},null,2)+'\n');
  need(evidenceBytes.length<=LIMITS.totalBytes,'evidence byte budget');
  need(Date.now()<deadline,'elapsed time budget');
  const digest=sha(evidenceBytes);const file='upstream-responses.'+digest+'.json';const dir=path.dirname(out);fs.mkdirSync(dir,{recursive:true});
  const evidencePath=path.join(dir,file);
  try {fs.writeFileSync(evidencePath,evidenceBytes,{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;need(fs.readFileSync(evidencePath).equals(evidenceBytes),'immutable evidence differs');}
  const data={schema:1,read_at:readAt,query:QUERY,open_query:OPEN_QUERY,evidence:{file,sha256:digest},pulls};
  const tmp=path.join(dir,'.upstream-'+randomUUID()+'.tmp');
  try {fs.writeFileSync(tmp,JSON.stringify(data,null,2)+'\n',{flag:'wx'});fs.renameSync(tmp,out);}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
  return data;
}
// Rebuild only the evidence projection from an existing observation, with no transport.
export function projectRecordedUpstream({out}={}) {
  const deadline=Date.now()+LIMITS.totalMs;
  out=path.resolve(out || fileURLToPath(new URL('../docs/data/upstream.json',import.meta.url)));
  need(fs.statSync(out).size<=LIMITS.totalBytes,'snapshot byte budget');
  const data=JSON.parse(fs.readFileSync(out,'utf8'));
  need(data.schema===1 && validTime(data.read_at) && data.query===QUERY && data.open_query===OPEN_QUERY,'snapshot metadata');
  need(data.evidence && /^[a-f0-9]{64}$/.test(data.evidence.sha256) && data.evidence.file==='upstream-responses.'+data.evidence.sha256+'.json','evidence seal');
  const old=path.join(path.dirname(out),data.evidence.file);
  need(fs.statSync(old).size<=LIMITS.totalBytes,'evidence byte budget');
  const bytes=fs.readFileSync(old);need(sha(bytes)===data.evidence.sha256,'evidence seal');
  const evidence=JSON.parse(bytes);
  need(evidence.read_at===data.read_at && evidence.query===data.query && evidence.open_query===data.open_query,'sealed metadata');
  const pulls=deriveUpstream(evidence.responses);need(isDeepStrictEqual(pulls,data.pulls),'data row facts differ from sealed observations');
  const projected=installSnapshot(out,evidence.responses,data.read_at,pulls,deadline);
  // Only this successful reprojection retires its superseded file. Refreshes keep prior evidence.
  if(projected.evidence.file!==data.evidence.file)fs.unlinkSync(old);
  return projected;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args={};const names={'--out':'out','--fixture':'fixture','--read-at':'readAt'};
  try {
    let data;
    if(process.argv[2]==='--project-recorded') {
      need(process.argv.length===3,'usage: refresh-upstream.mjs --project-recorded');
      data=projectRecordedUpstream();
    } else {
      for(let i=2;i<process.argv.length;i+=2){need(names[process.argv[i]] && process.argv[i+1],'usage: refresh-upstream.mjs [--fixture file] [--out file] [--read-at ISO]');args[names[process.argv[i]]]=process.argv[i+1];}
      data=await refreshUpstream(args);
    }
    console.log('upstream: '+data.pulls.length+' merged PRs observed at '+data.read_at);
  }catch(e){console.error('upstream: refused: '+e.message);process.exitCode=1;}
}
