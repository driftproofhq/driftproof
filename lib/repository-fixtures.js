// SPDX-License-Identifier: Apache-2.0
'use strict';
// Issue 786. The fixture servers of a tools-on draw. They run as their own uid inside the draw's
// loopback-only network namespace, serve only the files their pinned manifest names (each checked
// by sha256 before listening), and record every request where the tool user cannot write.
//   node repository-fixtures.js <config.json>      prints "ready" once every server listens
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const LIMITS=Object.freeze({requests:4096,file_bytes:67108864,body_bytes:65536});
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function loadFiles(server){
  const files=new Map();
  for(const [rel,want] of Object.entries(server.files||{})){
    if(!/^[A-Za-z0-9._@%+\/-]+$/.test(rel)||rel.split('/').some(p=>!p||p==='.'||p==='..'))throw Error('Fixture path refused: '+rel);
    const bytes=fs.readFileSync(path.join(server.root,rel));
    if(bytes.length>LIMITS.file_bytes||sha(bytes)!==want)throw Error('Fixture byte differs: '+server.name+'/'+rel);
    files.set(rel,bytes);
  }
  return files;
}
// The skills.sh search API, read from the pinned index: every query term must appear in the name or
// description; results by installs, as the registry ranks them.
function skillsSearch(index,url){
  const q=(url.searchParams.get('q')||'').toLowerCase().split(/\s+/).filter(Boolean),owner=(url.searchParams.get('owner')||'').toLowerCase();
  const hits=index.skills.filter(s=>q.length&&q.every(t=>(s.name+' '+s.description).toLowerCase().includes(t))&&(!owner||s.source.toLowerCase().startsWith(owner+'/')));
  return {skills:hits.sort((a,b)=>b.installs-a.installs).map(s=>({id:s.id,name:s.name,source:s.source,installs:s.installs}))};
}
// Issue 786, agent-browser: the fixture web app. Pages are pinned files; three forms change state,
// which is written where only the fixture user can write (app.json beside the request record).
const APP_PAGES=Object.freeze({'/':'index.html','/support':'support.html','/support/sent':'sent.html','/orders':'orders.html','/orders/7731':'order-7731.html',
  '/orders/7730':'order-7730.html','/signin':'signin.html','/account/delivery':'delivery.html','/account/delivery/saved':'saved.html'});
function formBody(req){return new Promise((resolve,reject)=>{let b='';req.on('data',c=>{b+=c;if(b.length>LIMITS.body_bytes){reject(Error('body'));req.destroy();}});req.on('end',()=>resolve(Object.fromEntries(new URLSearchParams(b))));req.on('error',reject);});}
function appHandler(files,state,save){
  return async (req,url)=>{
    const signedIn=/(?:^|;\s*)session=demo(?:;|$)/.test(req.headers.cookie||'');
    const page=rel=>({status:200,body:files.get(rel),type:'text/html; charset=utf-8'});
    const go=(to,headers={})=>({status:303,body:'',type:'text/plain; charset=utf-8',headers:{location:to,...headers}});
    if(req.method==='POST'){
      const f=await formBody(req);
      if(url.pathname==='/support'){state.submissions.push({form:'support',values:{name:String(f.name||''),order:String(f.order||''),topic:String(f.topic||''),message:String(f.message||'')}});save();return go('/support/sent');}
      if(url.pathname==='/signin'){if(f.user!=='demo')return go('/signin');state.state.signed_in_user='demo';save();return go('/account/delivery',{'set-cookie':'session=demo; Path=/; HttpOnly'});}
      if(url.pathname==='/account/delivery'){if(!signedIn)return go('/signin');state.state.delivery_note=String(f.note||'');save();return go('/account/delivery/saved');}
      return {status:404,body:'not in this fixture\n',type:'text/plain; charset=utf-8'};
    }
    if(url.pathname.startsWith('/account/')&&!signedIn)return go('/signin');
    const rel=APP_PAGES[url.pathname];return rel&&files.has(rel)?page(rel):{status:404,body:'not in this fixture\n',type:'text/plain; charset=utf-8'};
  };
}
function contentType(rel){return /\.json$/.test(rel)?'application/json':/\.tgz$/.test(rel)?'application/octet-stream':/\.html?$/.test(rel)?'text/html; charset=utf-8':'text/plain; charset=utf-8';}
async function start(config,{log=()=>{},saveApp=()=>{}}={}){
  let count=0;
  const record=(entry)=>{if(++count<=LIMITS.requests)log(entry);};
  const servers=config.servers.map(server=>{
    const files=loadFiles(server),index=server.kind==='skills-api'?JSON.parse(files.get('index.json')):null;
    const appState={submissions:[],state:{}},app=server.kind==='app'?appHandler(files,appState,()=>saveApp(appState)):null;
    // A fixture whose client accepts only https (the hyperframes registry) serves TLS with the image's
    // test certificate, which the session trusts through NODE_EXTRA_CA_CERTS.
    const create=server.tls?(handler)=>require('node:https').createServer({key:fs.readFileSync(server.tls.key),cert:fs.readFileSync(server.tls.cert)},handler):(handler)=>http.createServer(handler);
    const h=create(async(req,res)=>{
      let status=404,body='not in this fixture\n',type='text/plain; charset=utf-8',headers={};
      try{
        const url=new URL(req.url,'http://localhost');
        if(app){const r=await app(req,url);status=r.status;body=r.body;type=r.type;headers=r.headers||{};}
        else if(req.method!=='GET'&&req.method!=='HEAD')status=405;
        else if(server.kind==='skills-api'&&url.pathname==='/api/search'){status=200;body=JSON.stringify(skillsSearch(index,url));type='application/json';}
        else if(server.kind==='npm'){
          // A packument at /<name> or /@scope%2fname; a tarball at its pinned path.
          const name=decodeURIComponent(url.pathname.slice(1));
          const rel=files.has('packuments/'+name.replace('/','__')+'.json')?'packuments/'+name.replace('/','__')+'.json':url.pathname.slice(1);
          if(files.has(rel)){status=200;body=files.get(rel);type=contentType(rel);}
        }
        else{const rel=url.pathname.replace(/^\/+/,'').replace(/\/$/,'/index.html');if(files.has(rel)){status=200;body=files.get(rel);type=contentType(rel);}}
      }catch{status=400;body='bad request\n';}
      record({server:server.name,method:req.method,path:req.url.slice(0,512),status});
      res.writeHead(status,{'content-type':type,...headers});res.end(req.method==='HEAD'?undefined:body);
    });
    // "localhost" may resolve to either loopback family, so both are served when the namespace has ::1.
    return new Promise((resolve,reject)=>{h.on('error',reject);h.listen(server.port,'127.0.0.1',()=>{
      const h6=create(h.listeners('request')[0]);h6.on('error',()=>{});h6.listen(h.address().port,'::1',()=>{});
      const close=h.close.bind(h);h.close=(cb)=>{h6.close();return close(cb);};resolve(h);});});
  });
  return Promise.all(servers);
}
if(require.main===module){
  const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
  const out=fs.openSync(path.join(config.state,'requests.jsonl'),'a',0o600);
  const appFile=path.join(config.state,'app.json');
  const saveApp=s=>{fs.writeFileSync(appFile+'.pending',JSON.stringify(s),{mode:0o600});fs.renameSync(appFile+'.pending',appFile);};
  start(config,{log:e=>fs.writeSync(out,JSON.stringify(e)+'\n'),saveApp}).then(()=>process.stdout.write('ready\n'),e=>{process.stderr.write('fixture: '+e.message+'\n');process.exit(1);});
}
module.exports={LIMITS,start,loadFiles,skillsSearch};
