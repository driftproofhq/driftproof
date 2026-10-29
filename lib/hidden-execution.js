// SPDX-License-Identifier: Apache-2.0
'use strict';
// Execution preparation. Admission remains blocked until run/receipt integration.
const fs=require('node:fs'),path=require('node:path');
const S=require('./workspace-snapshot'),E=require('./repository-execution');
const {canonicalize,sha256}=require('./canonical');
const fail=(message)=>{const e=Error(message);e.code='EXECUTION_HARNESS';return e;};
const WALL_MS=10000;
function validateHiddenCase(c){
 if(!c||c.judge_only||!['javascript','python','sql'].includes(c.language)||!/^src\/solution\.(cjs|py|sql)$/.test(c.location)||!Array.isArray(c.test_names)||!c.test_names.length||c.test_names.length>128||new Set(c.test_names).size!==c.test_names.length||c.test_names.some(n=>typeof n!=='string'||n.length>160))throw fail('Invalid execution case.');
 if(c.runtime_modules!==undefined&&(!Array.isArray(c.runtime_modules)||c.runtime_modules.length>16||c.runtime_modules.some(x=>typeof x!=='string'||!/^[_a-zA-Z][_a-zA-Z0-9.]{0,79}$/.test(x))))throw fail('Invalid runtime dependency list.');
 const f=c.hidden;
 if(!f||!/^hidden\/tests\.(cjs|py)$/.test(f.path)||typeof f.base64!=='string'||f.base64.length>1048576)throw fail('Invalid hidden artifact.');
 const b=Buffer.from(f.base64,'base64');if(b.toString('base64')!==f.base64||b.length!==f.bytes||sha256(b)!==f.sha256)throw fail('Hidden artifact hash differs.');
 if(!Array.isArray(c.export_names)||c.export_names.some(x=>!/^\w+$/.test(x)))throw fail('Invalid export names.');
 return b;
}
function hiddenSupervisorPath(){return path.join(__dirname,'hidden-supervisor.js');}
function buildHiddenExecutionPlan({snapshot,caseSpec,user,runtime}){
 S.validateWorkspaceSnapshot(snapshot,runtime.runtime_image_digest);validateHiddenCase(caseSpec);
 const env=E.environment();for(const k of ['runtime_image_digest','effective_environment_hash'])if(env[k]!==runtime[k])throw fail('Execution runtime identity differs.');
 const p=E.buildPlan({bin:'node',args:[],user,timeoutMs:WALL_MS,phase:'hidden-tests'});
 return p;
}
function hiddenExecutionLaunch({image,workspace,control,temp,uid,gid,language}){
 const py=language!=='javascript';
 return {file:'/usr/bin/setpriv',env:{},args:['--reuid='+uid,'--regid='+gid,'--clear-groups','--no-new-privs','--inh-caps=-all','--ambient-caps=-all','--pdeathsig=KILL','--','/usr/bin/env','-i','/usr/bin/prlimit','--cpu=900:900','--fsize=67108864:67108864','--nofile=128:128','--','/usr/bin/bwrap',
 '--unshare-pid','--unshare-ipc','--unshare-uts','--unshare-net','--die-with-parent','--new-session','--cap-drop','ALL',
 '--ro-bind',image,'/','--bind',workspace,'/workspace','--ro-bind',control,'/control','--bind',temp,'/tooltmp','--proc','/proc','--dev','/dev','--tmpfs','/tmp','--chdir','/workspace','--clearenv','--setenv','PATH','/usr/bin:/bin','--setenv','HOME','/tmp',
 ...(py?['/usr/bin/python3','-I','-B','/control/runner.py']:['/usr/bin/node','/control/runner.cjs']),'/control/config.json']};
}
const JS=String.raw`
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),cfg=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const out={tests:[],phase:'load',scope:fs.readFileSync('/proc/self/cgroup','utf8')};
const save=()=>{fs.writeFileSync(cfg.report,JSON.stringify(out));};
const all=reason=>{out.tests=cfg.names.map(name=>({name,outcome:'fail',reason}));out.phase='done';save();};
(async()=>{
 save();try{new vm.Script(fs.readFileSync(cfg.hidden,'utf8'),{filename:cfg.hidden});}catch{out.harness_error='hidden_syntax';save();return;}
 if(!fs.existsSync(cfg.subject)){all('missing_file');return;}
 process.env.SUBJECT=cfg.subject;let subject;
 try{subject=require(cfg.subject);}catch{all('solution_error');return;}
 if(subject==null||cfg.exports.some(n=>!Object.hasOwn(subject,n))){all('missing_export');return;}
 let tests;try{tests=require(cfg.hidden);}catch{out.harness_error='hidden_load';save();return;}
 if(!Array.isArray(tests)||JSON.stringify(tests.map(t=>t.name))!==JSON.stringify(cfg.names)){out.harness_error='test_names';save();return;}
 out.phase='tests';save();
 for(const t of tests){try{await t.fn();out.tests.push({name:t.name,outcome:'pass'});}catch(e){out.tests.push({name:t.name,outcome:'fail',reason:e?.name==='AssertionError'?'assertion':'test_error'});}save();}
 out.phase='done';save();
})().catch(()=>{out.harness_error='runner';save();process.exitCode=1;});
`;
const PY=String.raw`
import sys,json,os,importlib.util,traceback
from pathlib import Path
cfg=json.loads(Path(sys.argv[1]).read_bytes())
out={'tests':[],'phase':'load','scope':Path('/proc/self/cgroup').read_text()}
def save(): Path(cfg['report']).write_text(json.dumps(out))
def all_failed(reason):
    out['tests']=[{'name':n,'outcome':'fail','reason':reason} for n in cfg['names']];out['phase']='done';save()
save()
for dependency in cfg['runtime_modules']:
    try: importlib.import_module(dependency)
    except BaseException: out['harness_error']='runtime_dependency:'+dependency;save();sys.exit(0)
try: compile(Path(cfg['hidden']).read_bytes(),cfg['hidden'],'exec')
except BaseException: out['harness_error']='hidden_syntax';save();sys.exit(0)
if not Path(cfg['subject']).is_file(): all_failed('missing_file');sys.exit(0)
if cfg['language']=='python':
    try: compile(Path(cfg['subject']).read_bytes(),cfg['subject'],'exec')
    except BaseException: all_failed('solution_error');sys.exit(0)
os.environ['SUBJECT']=cfg['subject']
try:
    s=importlib.util.spec_from_file_location('hidden',cfg['hidden']);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
except BaseException as e:
    if any(x.filename==cfg['subject'] for x in traceback.extract_tb(e.__traceback__)): all_failed('solution_error')
    else: out['harness_error']='hidden_load';save()
    sys.exit(0)
if cfg['language']=='python' and any(not hasattr(m.S,n) for n in cfg['exports']): all_failed('missing_export');sys.exit(0)
if [n for n,fn in m.TESTS]!=cfg['names']: out['harness_error']='test_names';save();sys.exit(0)
out['phase']='tests';save()
for name,fn in m.TESTS:
    try: fn();out['tests'].append({'name':name,'outcome':'pass'})
    except BaseException as e: out['tests'].append({'name':name,'outcome':'fail','reason':'assertion' if isinstance(e,AssertionError) else 'test_error'})
    save()
out['phase']='done';save()
`;
function prepareHiddenExecution(control,temp,workspace,c,{confined=true}={}){
 const bytes=validateHiddenCase(c);fs.mkdirSync(control,{mode:0o755});fs.mkdirSync(temp,{mode:0o700});
 const py=c.language!=='javascript',hidden=py?'tests.py':'tests.cjs',runner=py?'runner.py':'runner.cjs';
 fs.writeFileSync(path.join(control,hidden),bytes,{mode:0o444,flag:'wx'});
 fs.writeFileSync(path.join(control,runner),py?PY:JS,{mode:0o444,flag:'wx'});
 const cfg={language:c.language,runtime_modules:c.runtime_modules||[],names:c.test_names,exports:c.export_names,subject:path.join(confined?'/workspace':workspace,c.location),hidden:path.join(confined?'/control':control,hidden),report:path.join(confined?'/tooltmp':temp,'report.json')};
 fs.writeFileSync(path.join(control,'config.json'),JSON.stringify(cfg),{mode:0o444,flag:'wx'});
 return {runner:path.join(control,runner),config:path.join(control,'config.json'),report:path.join(temp,'report.json')};
}
function readHiddenReport(file){
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{const st=fs.fstatSync(fd);if(!st.isFile()||st.size>65536)throw fail('Execution report size or type.');const b=Buffer.alloc(st.size+1);let n=0,k;while((k=fs.readSync(fd,b,n,b.length-n,null))>0){n+=k;if(n>st.size)throw fail('Execution report grew.');}return JSON.parse(b.subarray(0,n).toString('utf8'));}finally{fs.closeSync(fd);}
}
function hiddenExecutionOutcome(c,result,report){
 const unmeasured=reason=>({status:'unmeasured',pass_rate:null,reason,tests:[],diagnostics:E.repositoryProcessDiagnostics(result)});
 if(!report||report.harness_error)return unmeasured(report?.harness_error||'missing_report');
 if(!Array.isArray(report.tests)||report.tests.length>c.test_names.length||report.tests.some((r,i)=>r.name!==c.test_names[i]||!['pass','fail'].includes(r.outcome)))return unmeasured('invalid_report');
 if(result.delivery)return unmeasured('stream_limit');
 const tests=structuredClone(report.tests);
 if(result.timedOut)for(const name of c.test_names.slice(tests.length))tests.push({name,outcome:'fail',reason:'test_timeout'});
 else if((result.code??result.status)!==0||report.phase!=='done'||tests.length!==c.test_names.length)return unmeasured('unfinished_harness');
 const passed=tests.filter(t=>t.outcome==='pass').length;
 return {status:'measured',tests,passed,total:tests.length,pass_rate:passed/tests.length,scope:report.scope,diagnostics:E.repositoryProcessDiagnostics(result)};
}
async function publishFinalWorkspace(snapshot,{directory,runtime}){
 S.validateWorkspaceSnapshot(snapshot,runtime.runtime_image_digest);
 const saved=await require('./checkpoint').invokeLocalPhase(async()=>{
  const snapshotFile=S.publishWorkspaceSnapshot(directory,snapshot);S.loadWorkspaceSnapshot(snapshotFile,runtime.runtime_image_digest);
  return {snapshotFile,snapshot_hash:snapshot.snapshot_hash};
 },{snapshot_hash:snapshot.snapshot_hash,runtime_image_digest:runtime.runtime_image_digest},'snapshot');
 // Cached metadata never replaces verification of the actual durable snapshot bytes.
 S.loadWorkspaceSnapshot(saved.snapshotFile,runtime.runtime_image_digest);return saved;
}
async function captureFinalWorkspace(p,{directory,...opts}){
 if(!p.args.includes('--snapshot'))throw fail('Generation plan did not request a complete snapshot.');
 const result=await E.execute(p,opts);const snapshot=S.validateWorkspaceSnapshot(result.workspace_snapshot,p.repository.runtime_image_digest);
 const saved=await publishFinalWorkspace(snapshot,{directory,runtime:p.repository});
 return {result,...saved};
}
async function executeHiddenTests({snapshotFile,caseSpec,user,runtime,freezeHash}){
 if(!/^[a-f0-9]{64}$/.test(freezeHash))throw fail('Execution freeze binding absent.');
 const snapshot=S.loadWorkspaceSnapshot(snapshotFile,runtime.runtime_image_digest),p=buildHiddenExecutionPlan({snapshot,caseSpec,user,runtime});
 // Only execution material is sent here. No reference/broken source enters the scope.
 const selected={id:caseSpec.id,runtime_modules:caseSpec.runtime_modules||[],language:caseSpec.language,location:caseSpec.location,export_names:caseSpec.export_names,test_names:caseSpec.test_names,hidden:caseSpec.hidden};
 const input=JSON.stringify({snapshot,caseSpec:selected});
 return require('./checkpoint').invokeLocalPhase(async()=>{
 const result=await E.execute(p,{input,timeoutMs:WALL_MS+60000,graceMs:0});
 if(!result.execution)throw fail('Missing execution frame.');
 const doc={...result.execution,snapshot_hash:snapshot.snapshot_hash,hidden_test_hash:caseSpec.hidden.sha256,test_names_hash:sha256(canonicalize(caseSpec.test_names)),freeze_hash:freezeHash,runtime_image_digest:runtime.runtime_image_digest,effective_environment_hash:runtime.effective_environment_hash,scope_unit:p.scope,wall_ms:WALL_MS,evidence_kind:result.evidence_kind||'observed'};
 return {...doc,execution_hash:sha256(canonicalize(doc))};
 },{snapshot_hash:snapshot.snapshot_hash,caseSpec:selected,freeze_hash:freezeHash,runtime_image_digest:runtime.runtime_image_digest,effective_environment_hash:runtime.effective_environment_hash,wall_ms:WALL_MS},'hidden-execution');
}

module.exports={WALL_MS,validateHiddenCase,hiddenSupervisorPath,buildHiddenExecutionPlan,hiddenExecutionLaunch,prepareHiddenExecution,readHiddenReport,hiddenExecutionOutcome,captureFinalWorkspace,publishFinalWorkspace,executeHiddenTests};
