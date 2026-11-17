// SPDX-License-Identifier: Apache-2.0
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parseYaml } = require('../specs/024-runner-hostile-input-proof/probes/yaml');
const { sealReceipt } = require('../lib/receipt');
const { readingOf } = require('../lib/reading-words');
const { RULES_FILE_KINDS } = require('../lib/rules-files');
const ROOT = path.resolve(__dirname, '..');
const P = () => require('../action/pr-check');
const made = [];
const tmp = () => { const d = fs.mkdtempSync('/var/tmp/action-820-'); made.push(d); return d; };
const write = (root, rel, text) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), {recursive:true}); fs.writeFileSync(f, typeof text === 'string' ? text : JSON.stringify(text)); return f; };
const suite = {cases:[{id:'one',prompt:'Name a fruit.',rubric:'Names a fruit.'}]};
test.after(() => made.forEach(d => fs.rmSync(d, {recursive:true,force:true})));
function fixture() {
  const root = tmp();
  write(root,'skills/a/SKILL.md','# Skill\nName fruit.\n'); write(root,'skills/a/evals/evals.json',suite);
  write(root,'CLAUDE.md','# Rules\nBe brief.\n'); write(root,'evals/evals.json',suite);
  return root;
}
function env(root) {
  return {PATH:process.env.PATH, TMPDIR:'/var/tmp', DRIFTPROOF_STUB:'1', GITHUB_ACTION_PATH:ROOT,
    RUNNER_TEMP:tmp(), GITHUB_OUTPUT:path.join(tmp(),'out'), GITHUB_STEP_SUMMARY:path.join(tmp(),'summary'),
    GITHUB_JOB:'check', GITHUB_ACTION:'driftproof', GITHUB_WORKFLOW_REF:'example/repo/.github/workflows/checks.yml',
    GITHUB_WORKSPACE:root, GITHUB_EVENT_NAME:'pull_request', GITHUB_REPOSITORY:'example/repo',
    GITHUB_EVENT_PATH:write(tmp(),'event.json',{pull_request:{number:1,head:{sha:'a'.repeat(40),repo:{full_name:'example/repo'}},base:{sha:'b'.repeat(40),repo:{full_name:'example/repo'}}}}),
    INPUT_SKILL_DIR:'', INPUT_SUITE:'', INPUT_PLACEBO:'true', INPUT_COMPARE_WITH_BASE:'false',
    INPUT_MODELS:'claude-haiku-5-5', INPUT_MAX_USD:'20', INPUT_MAX_CALLS:'2000', INPUT_FAIL_ON_REGRESSION:'true', INPUT_FAIL_ON_UNDERPOWERED:'false', INPUT_FAIL_ON_FAKE:'false'};
}
const git = args => args[0] === 'rev-parse' ? 'a'.repeat(40) : 'skills/a/SKILL.md\0CLAUDE.md\0';
let archive;
function examples() {
  if (!archive) archive = require('../scripts/build-receipt-pages').receipts().map(x => x.receipt);
  return archive;
}
function measured(kind) { const r = examples().find(r => { try { return readingOf(r).reading === kind; } catch { return false; } }); assert.ok(r, kind); return structuredClone(r); }
function set(r) { const d=tmp(); write(d,'receipt.json',r); return d; }

test('820 AC-1 discovery deduplicates changed bundles, all shared rules kinds and deleted subjects', () => {
  const root=fixture();
  const files=RULES_FILE_KINDS.filter(k=>k.kind!=='markdown').map(k=>k.example.replace('*','style'));
  for(const file of files) write(root,file,'# Rules\nBe brief.\n');
  write(root,'skills/new/SKILL.md','# New skill\n');
  write(root,'skills/a/nested/SKILL.md','# Nested skill\n');
  const got=P().discover(root,[...files,'skills/a/extra.txt','skills/a/SKILL.md','skills/a/nested/file.txt','skills/new/SKILL.md','old/SKILL.md','gone/AGENTS.md','notes.md']);
  assert.deepEqual(got.map(x=>x.file).sort(),[...new Set([...files,'skills/a/SKILL.md','skills/a/nested/SKILL.md','skills/new/SKILL.md','old/SKILL.md','gone/AGENTS.md'])].sort());
  assert.equal(got.find(x=>x.file==='skills/new/SKILL.md').reason,'no test cases');
  assert.equal(got.find(x=>x.file==='old/SKILL.md').reason,'deleted');
  assert.equal(got.find(x=>x.file==='CLAUDE.md').suite,'evals/evals.json');
});
test('820 AC-2 links, traversal and control bytes cannot become subjects or suites', () => {
  for(const rel of ['../CLAUDE.md','/CLAUDE.md','x/../CLAUDE.md','CLAUDE.md\n']) assert.throws(()=>P().discover(fixture(),[rel]),/path/i);
  const root=fixture(); fs.symlinkSync(path.dirname(root),path.join(root,'linked'));
  assert.throws(()=>P().discover(root,['linked/CLAUDE.md']),/link/i);
  fs.rmSync(path.join(root,'evals'),{recursive:true}); fs.symlinkSync(path.join(root,'skills/a/evals'),path.join(root,'evals'));
  assert.throws(()=>P().discover(root,['CLAUDE.md']),/link/i);
});
test('820 AC-3 and AC-4 every receipt verifies before numbers, with missing, extra, duplicate and wrong identity plants', () => {
  const r=measured('NO_DIFFERENCE'), dir=set(r), model=r.run.model_id;
  const valid=P().readSet(dir,model,{}); assert.equal(valid.rows.length,1); assert.equal(valid.rows[0].reading,readingOf(r).text);
  assert.throws(()=>P().readSet(dir,model,{}, {contentHash:'0'.repeat(64),suiteHash:r.suite.suite_hash}),/identity/i);
  const bad=structuredClone(r); bad.skill.name+='x'; write(dir,'receipt.json',bad);
  assert.throws(()=>P().readSet(dir,model,{}),/hash|seal/i);
  bad.run.date_utc='bad'; sealReceipt(bad); write(dir,'receipt.json',bad);
  assert.throws(()=>P().readSet(dir,model,{}),/schema/i);
  write(dir,'receipt.json',r); write(dir,'duplicate.json',r);
  assert.throws(()=>P().readSet(dir,model,{}),/receipt/i);
  fs.rmSync(path.join(dir,'duplicate.json')); const extra=structuredClone(r); extra.run.model_id='claude-sonnet-5-5'; sealReceipt(extra); write(dir,'extra.json',extra);
  assert.throws(()=>P().readSet(dir,model,{}),/receipt/i);
  fs.rmSync(path.join(dir,'extra.json')); write(dir,'receipt.json','{'); assert.throws(()=>P().readSet(dir,model,{}),/receipt/i);
  fs.rmSync(path.join(dir,'receipt.json')); assert.throws(()=>P().readSet(dir,model,{}),/receipt/i);
});
test('820 AC-5 fake loss fails only when selected, never a tie; regression is independent', () => {
  for(const kind of ['BELOW_PLACEBO','NO_DIFFERENCE','REGRESSED']) {
    const r=measured(kind), dir=set(r), model=r.run.model_id;
    const off=P().readSet(dir,model,{failOnRegression:false,failOnFake:false}); assert.equal(off.fails,false);
    const on=P().readSet(dir,model,{failOnRegression:false,failOnFake:true}); assert.equal(on.fails,kind==='BELOW_PLACEBO');
    if(kind==='REGRESSED') assert.equal(P().readSet(dir,model,{failOnRegression:true}).fails,true);
  }
});
test('820 AC-4 table uses shared readings, escaped paths, distinct measured count and receipts link', () => {
  const r=measured('NO_DIFFERENCE'), dir=tmp(); write(dir,'subject-0/receipt.json',r);
  const file='skills/a | <tag> [link]/SKILL.md';
  const manifest={subjects:[{file,dir:'subject-0'}],models:r.run.model_id,skipped:[{file:'skills/new/SKILL.md',reason:'no test cases'}]};
  const body=P().render(manifest,dir,{},'https://github.com/example/repo/actions/runs/1');
  assert.ok(body.includes(require('../lib/names').mdText(file))); assert.ok(body.includes(readingOf(r).text));
  assert.match(body,/1 changed file measured/); assert.match(body,/Change vs without \| Change vs fake \| Reading \| Receipt/);
  assert.ok(body.includes('['+r.receipt_hash.slice(0,8)+'](https://github.com/example/repo/actions/runs/1#artifacts)'));
  assert.match(body,/Not measured:.*skills\/new\/SKILL/); assert.match(body,/npx driftproof init/);
  const noFake=measured('REGRESSED'); write(dir,'subject-0/receipt.json',noFake); manifest.models=noFake.run.model_id;
  assert.match(P().render(manifest,dir,{}),/\| not run \|/);
});
test('820 AC-6 fork makes no calls and prints only the approved result; mismatched HEAD fails', () => {
  const root=fixture(), e=env(root); const event=JSON.parse(fs.readFileSync(e.GITHUB_EVENT_PATH)); event.pull_request.head.repo.full_name='someone/fork'; write(path.dirname(e.GITHUB_EVENT_PATH),'event.json',event);
  const bomb=()=>{throw new Error('called');}; const out=P().run(e,{git:bomb,invoke:bomb});
  assert.equal(fs.readFileSync(e.GITHUB_STEP_SUMMARY,'utf8').trim(),P().FORK_LINE);
  assert.equal(P().result(out,e).fails,false);
  const e2=env(root); assert.throws(()=>P().run(e2,{git:()=> 'c'.repeat(40),invoke:bomb}),/head/i);
  const e3=env(root); write(path.dirname(e3.GITHUB_EVENT_PATH),'event.json',{}); assert.throws(()=>P().run(e3,{git,invoke:bomb}),/event/i);
});
test('820 AC-6 API provider keys are checked without subscription fallback', () => {
  const e=env(fixture()); delete e.DRIFTPROOF_STUB;
  assert.throws(()=>P().requireKeys({...e,INPUT_MODELS:'gpt-5.6-sol',ANTHROPIC_API_KEY:'fixture'}),/OpenAI/i);
  assert.throws(()=>P().requireKeys({...e,INPUT_MODELS:'claude-haiku-5-5',OPENAI_API_KEY:'fixture'}),/Anthropic/i);
});
test('820 AC-8 real stub runs isolate subjects, conserve caps, seal identities and count no measurements', () => {
  const root=fixture(), e=env(root); write(root,'.driftproofrc','{');
  const out=P().run(e,{git}); const m=JSON.parse(fs.readFileSync(path.join(out,'check.json')));
  assert.equal(m.subjects.length,2); assert.equal(m.subjects[0].maxUsd,10); assert.equal(m.subjects[0].maxCalls,1000);
  assert.notEqual(m.subjects[0].dir,m.subjects[1].dir); assert.equal(P().result(out,e).fails,false);
  const body=fs.readFileSync(e.GITHUB_STEP_SUMMARY,'utf8'); assert.match(body,/0 changed files measured/); assert.match(body,/not measured/); assert.doesNotMatch(body,/\| [−+]\d/);
  const out2=P().run({...e,GITHUB_OUTPUT:path.join(tmp(),'out')},{git}); assert.notEqual(out,out2);
  const first=path.join(out,m.subjects[0].dir); const files=require('../lib/receipt').listReceipts(first); fs.rmSync(files[0].file);
  assert.equal(P().result(out,e).fails,true);
});
test('820 AC-9 copyable workflow and metadata agree with the README and site source', () => {
  const a=parseYaml(fs.readFileSync(path.join(ROOT,'action.yml'),'utf8'));
  assert.ok(a.name && a.description.length <= 125); assert.deepEqual(a.branding,{icon:'shield',color:'green'});
  assert.equal(String(a.inputs['skill-dir'].required),'false'); assert.equal(a.inputs.models.default,'claude-haiku-5-5');
  assert.equal(a.inputs['fail-on-fake'].default,'false'); assert.ok(a.inputs['openai-api-key']);
  for(const s of a.runs.steps) if(s.run) assert.equal(s.run.includes('$'+'{{'),false);
  assert.equal(a.runs.steps.find(s=>s.id==='run').env.OPENAI_API_KEY,'$'+'{{ inputs.openai-api-key }}');
  const workflow=fs.readFileSync(path.join(ROOT,'examples/workflows/driftproof-pr.yml'),'utf8');
  const version=require('../package.json').version;
  assert.deepEqual(workflow.split('\n').map(line=>line.trim()).filter(line=>line.startsWith('- uses: driftproofhq/driftproof@')),
    [`- uses: driftproofhq/driftproof@v${version}`], 'the copyable workflow pins the package version');
  assert.match(workflow,/on: \[pull_request\]/); assert.doesNotMatch(workflow,/pull_request_target|skill-dir:/);
  assert.match(workflow,/persist-credentials: false/); assert.match(workflow,/fetch-depth: 0/); assert.match(workflow,/pull-requests: write/);
  assert.ok(fs.readFileSync(path.join(ROOT,'README.md'),'utf8').includes(workflow.trim()));
  assert.ok(fs.readFileSync(path.join(ROOT,'scripts/build-site-pages.js'),'utf8').includes('driftproof-pr.yml'));
  const listing=fs.readFileSync(path.join(ROOT,'deploy/marketplace-listing.md'),'utf8'); assert.match(listing,/Categories:/); assert.ok(listing.includes(workflow.trim()));
});

test('820 AC-7 one bot comment updates across pushes, a human marker is preserved, denied permission is harmless', () => {
  const e=env(fixture()), dir=tmp(); write(dir,'check.json',{fork:true,models:e.INPUT_MODELS,subjects:[],skipped:[]});
  const posted=path.join(tmp(),'posted.json'), emitted=path.join(tmp(),'stdout');
  const marker=P().automaticMarker(e);
  const code=`const write=process.stdout.write.bind(process.stdout);
    process.stdout.write=(chunk,...rest)=>{require('fs').appendFileSync(process.env.EMITTED,chunk); return write(chunk,...rest);};
    global.fetch=async (url, opts)=>{
    if(process.env.DENIED) return {ok:false,status:403};
    if(String(url).endsWith('/graphql')) return {ok:true,status:200,json:async()=>({data:{viewer:{login:'owned-app[bot]'}}})};
    if(opts.method==='GET') return {ok:true,status:200,json:async()=>[
      {id:12,body:process.env.MARKER+'\\nold',user:{type:'User'}},
      ...(process.env.EXISTING ? [{id:13,body:process.env.MARKER+'\\nold',user:{type:'Bot',login:'owned-app[bot]'}}] : [])]};
    require('fs').writeFileSync(process.env.POSTED,JSON.stringify({url,method:opts.method,...JSON.parse(opts.body)}));
    return {ok:true,status:200,json:async()=>({id:13})};
  }; require(process.env.COMMENT);`;
  function post(extra={}) { fs.rmSync(posted,{force:true}); fs.writeFileSync(emitted,''); return spawnSync(process.execPath,['-e',code],{encoding:'utf8',timeout:1800000,
    env:{...e,DRIFTPROOF_RECEIPTS:dir,GITHUB_TOKEN:'fixture',MARKER:marker,POSTED:posted,EMITTED:emitted,COMMENT:path.join(ROOT,'action/comment.js'),...extra}}); }
  const first=post(); assert.equal(first.status,0,first.stderr); assert.equal(JSON.parse(fs.readFileSync(posted)).method,'POST');
  const second=post({EXISTING:'1'}); assert.equal(second.status,0,second.stderr);
  const body=JSON.parse(fs.readFileSync(posted)); assert.equal(body.method,'PATCH'); assert.match(body.url,/comments\/13$/); assert.equal(body.body,marker+'\n'+P().FORK_LINE+'\n');
  const refused=post({DENIED:'1'}); assert.equal(refused.status,0); assert.equal(fs.existsSync(posted),false); assert.match(fs.readFileSync(emitted,'utf8'),/::notice.*403/);
  assert.equal(P().result(dir,e).fails,false);
});
test('820 AC-5 explicit-file enforcement and summary agree, and base receipts cannot decide the optional fake failure', () => {
  const r=measured('BELOW_PLACEBO'), dir=set(r), e={...env(fixture()),INPUT_SKILL_DIR:'CLAUDE.md',INPUT_MODELS:r.run.model_id,INPUT_FAIL_ON_REGRESSION:'false',INPUT_FAIL_ON_FAKE:'true',
    DRIFTPROOF_RECEIPTS:dir,DRIFTPROOF_VERDICT:'NO_EFFECT',DRIFTPROOF_DELTA:'0'};
  write(dir,'base/bad.json','{');
  const enforce=extra=>spawnSync('bash',[path.join(ROOT,'action/enforce.sh')],{env:{...e,...extra},encoding:'utf8',timeout:1800000});
  assert.equal(enforce({}).status,1); assert.match(P().singleMarkdown(e),/Check result: failed, a loss to the fake/);
  assert.equal(enforce({INPUT_FAIL_ON_FAKE:'false'}).status,0);
  write(dir,'receipt.json','{'); assert.equal(enforce({}).status,1);
});
test('820 AC-2 exact base and head diff arguments include deletions and renames without shell interpretation', () => {
  const root=fixture(), e=env(root), seen=[];
  const out=P().run(e,{git:args=>{seen.push(args); return args[0]==='rev-parse' ? 'a'.repeat(40) : 'old/SKILL.md\0';},invoke:()=>{throw new Error('unexpected call');}});
  assert.deepEqual(seen,[['rev-parse','HEAD'],['diff','--no-ext-diff','--no-textconv','--name-only','--no-renames','-z','b'.repeat(40)+'...'+'a'.repeat(40),'--']]);
  assert.match(fs.readFileSync(e.GITHUB_STEP_SUMMARY,'utf8'),/Not measured: old\/SKILL.md, deleted/);
  assert.equal(P().result(out,e).fails,false);
});
test('820 AC-8 a partial runner failure stays failed after comment rendering and in enforcement', () => {
  const e=env(fixture());
  const out=P().run(e,{git,invoke:()=>({status:1,stdout:'',stderr:''})});
  const m=JSON.parse(fs.readFileSync(path.join(out,'check.json')));
  assert.equal(m.subjects.length,2); assert.ok(m.subjects.every(x=>x.error));
  assert.equal(P().result(out,e).fails,true); assert.match(P().render(m,out,{}),/Check result: failed/);
  const enforced=spawnSync('bash',[path.join(ROOT,'action/enforce.sh')],{env:{...e,DRIFTPROOF_RECEIPTS:out,DRIFTPROOF_VERDICT:'REFUSED',DRIFTPROOF_DELTA:'n/a'},encoding:'utf8',timeout:1800000});
  assert.equal(enforced.status,1);
});

test('820 AC-8 new enforcement modes retain hostile verdict and delta refusals', () => {
  const e={...env(fixture()),DRIFTPROOF_RECEIPTS:tmp(),DRIFTPROOF_VERDICT:'NO_EFFECT',DRIFTPROOF_DELTA:'0'};
  for(const mode of [{INPUT_SKILL_DIR:''},{INPUT_SKILL_DIR:'CLAUDE.md',INPUT_FAIL_ON_FAKE:'true'}]) {
    for(const bad of [{DRIFTPROOF_VERDICT:'NO_EFFECT;bad'},{DRIFTPROOF_DELTA:'0\nnext'},{INPUT_FAIL_ON_FAKE:'yes'}]) {
      const r=spawnSync('bash',[path.join(ROOT,'action/enforce.sh')],{env:{...e,...mode,...bad},encoding:'utf8',timeout:1800000});
      assert.equal(r.status,1);
    }
  }
});


// Issue 829: regressions written before the follow-up implementation.
test('829 AC-1 and AC-3 unrelated changed links are named once and do not stop regular subjects', () => {
  const root=fixture(), e=env(root), outside=fixture();
  fs.symlinkSync(outside,path.join(root,'unrelated-link'));
  fs.symlinkSync(path.join(outside,'missing'),path.join(root,'dangling-link'));
  const changed=['unrelated-link','dangling-link','unrelated-link','CLAUDE.md'];
  const found=P().discover(root,changed);
  assert.equal(found.filter(x=>x.file==='CLAUDE.md' && !x.reason).length,1);
  for(const file of ['unrelated-link','dangling-link']) {
    assert.equal(found.filter(x=>x.file===file).length,1);
    assert.match(found.find(x=>x.file===file).reason,/link/i);
  }
  assert.equal(found.length,3,'the linked directory is never searched for subjects');
  const out=P().run(e,{git:args=>args[0]==='rev-parse'?'a'.repeat(40):changed.join('\0')+'\0'});
  const manifest=JSON.parse(fs.readFileSync(path.join(out,'check.json')));
  assert.deepEqual(manifest.subjects.map(x=>x.file),['CLAUDE.md']);
  assert.equal(manifest.skipped.length,2);
  const summary=fs.readFileSync(e.GITHUB_STEP_SUMMARY,'utf8');
  for(const file of ['unrelated-link','dangling-link']) assert.match(summary,new RegExp('Not measured: '+file+', .*link','i'));
  assert.match(summary,/0 changed files measured/);
  assert.equal(P().result(out,e).fails,false);
});
test('829 AC-2 linked measured subjects and suites still refuse before any runner call', () => {
  for(const file of ['CLAUDE.md','skills/a/SKILL.md','evals/evals.json']) {
    const root=fixture(), e=env(root), target=write(tmp(),'target',file.endsWith('.json')?suite:'# Rules\nBe brief.\n');
    fs.rmSync(path.join(root,file)); fs.symlinkSync(target,path.join(root,file));
    let calls=0;
    assert.throws(()=>P().run(e,{git,invoke:()=>{calls++;throw new Error('runner called');}}),/link/i);
    assert.equal(calls,0);
  }
});
test('829 AC-3 skipped links cannot inflate receipt-backed measured counts', () => {
  const r=measured('NO_DIFFERENCE'), dir=tmp(); write(dir,'subject-0/receipt.json',r);
  const manifest={models:r.run.model_id,subjects:[{file:'CLAUDE.md',dir:'subject-0'}],skipped:[{file:'unrelated-link',reason:'symbolic link'}]};
  assert.match(P().render(manifest,dir,{}),/1 changed file measured/);
  r.skill.name+='tampered'; write(dir,'subject-0/receipt.json',r);
  const refused=P().render(manifest,dir,{});
  assert.match(refused,/0 changed files measured/); assert.match(refused,/Check result: failed/);
});

// Both descriptors share a file so the oracle reads actual write order.
function shell829(e, inject=false) {
  const bin=tmp(), log=path.join(tmp(),'job-log'), calls=path.join(tmp(),'calls');
  const shim=[
    "const fs=require('node:fs'), cp=require('node:child_process');",
    "fs.appendFileSync(process.env.CALLS829,JSON.stringify(process.argv.slice(2))+'\\n');",
    "if(process.argv[2].endsWith('/bin/driftproof')) process.exit(91);",
    "if(process.env.INJECT829==='1' && process.argv[3]==='run') process.stdout.write('::error title=Untrusted::forged\\n##[error]forged legacy\\n');",
    "const r=cp.spawnSync(process.execPath,process.argv.slice(2),{env:process.env,stdio:'inherit',timeout:1800000});",
    "process.exit(r.status===null?92:r.status);"
  ].join('\n');
  write(bin,'node','#!'+process.execPath+'\n'+shim); fs.chmodSync(path.join(bin,'node'),0o755);
  const fd=fs.openSync(log,'w'); let r;
  try { r=spawnSync('bash',[path.join(ROOT,'action/run.sh')],{cwd:e.GITHUB_WORKSPACE,
    env:{...e,PATH:bin+path.delimiter+e.PATH,CALLS829:calls,INJECT829:inject?'1':'0'},stdio:['ignore',fd,fd],timeout:1800000}); }
  finally { fs.closeSync(fd); }
  assert.ifError(r.error);
  return {status:r.status,text:fs.readFileSync(log,'utf8'),calls:fs.existsSync(calls)?fs.readFileSync(calls,'utf8'):''};
}
function activeCommands829(text) {
  let stopped=null; const active=[];
  for(const line of text.split(/\r?\n/)) {
    if(stopped) { if(line==='::'+stopped+'::') stopped=null; continue; }
    if(line.startsWith('::stop-commands::')) { stopped=line.slice('::stop-commands::'.length); continue; }
    if(line.startsWith('::error') || line.includes('##[error]')) active.push(line);
  }
  return {active,stopped};
}
test('829 AC-4 the automatic error reaches the job log after the fence, forged commands do not', () => {
  const e=env(fixture()); write(path.dirname(e.GITHUB_EVENT_PATH),'event.json',{});
  const r=shell829(e,true); assert.notEqual(r.status,0);
  assert.match(r.text,/title=Untrusted/,'the hostile output plant actually ran');
  const parsed=activeCommands829(r.text);
  assert.equal(parsed.stopped,null,'workflow command parsing resumes on failure');
  assert.equal(parsed.active.length,1,'one trusted error annotation is active');
  assert.match(parsed.active[0],/^::error title=Driftproof::/);
  assert.doesNotMatch(parsed.active.join('\n'),/forged|Untrusted/);
});
test('829 AC-7 explicit errors name the missing provider key and no subscription fallback without values', () => {
  for(const [model,missing,other] of [
    ['claude-haiku-5-5',/ANTHROPIC_API_KEY|\bapi-key\b/,'OPENAI_API_KEY'],
    ['gpt-5.6-sol',/OPENAI_API_KEY|openai-api-key/,'ANTHROPIC_API_KEY']
  ]) for(const wrongKey of [false,true]) {
    const e={...env(fixture()),INPUT_SKILL_DIR:'CLAUDE.md',INPUT_MODELS:model};
    delete e.DRIFTPROOF_STUB;
    if(wrongKey) e[other]='private-fixture-value-829';
    const r=shell829(e);
    assert.notEqual(r.status,0); assert.match(r.text,missing);
    assert.match(r.text,/explicit mode.*never falls back to a subscription login/i);
    assert.doesNotMatch(r.text,/private-fixture-value-829/);
    assert.doesNotMatch(r.calls,/\/bin\/driftproof/,'the runner must never start');
    assert.equal(fs.readdirSync(e.RUNNER_TEMP).length,0,'key refusal creates no run directories');
  }
});

async function comment829(e, comments=[], identity={type:'Bot',login:'owned-app[bot]'}) {
  const vm=require('node:vm'), {createRequire}=require('node:module');
  const filename=path.join(ROOT,'action/comment.js'), writes=[], messages=[], requests=[];
  let finish;
  const done=new Promise(resolve=>{finish=resolve;});
  const processMock={env:e,stdout:{write:s=>{messages.push(String(s));return true;}}};
  Object.defineProperty(processMock,'exitCode',{set:finish});
  const context={require:createRequire(filename),process:processMock,URL,AbortSignal,
    console:{log:s=>messages.push(String(s))},
    fetch:async(url,opts)=>{
      requests.push({url:String(url),method:opts.method,authorization:opts.headers.authorization});
      if(String(url).endsWith('/graphql')) {
        assert.equal(opts.method,'POST');
        assert.equal(opts.headers.authorization,'Bearer '+e.GITHUB_TOKEN);
        assert.match(JSON.parse(opts.body).query,/viewer\s*\{\s*login\s*\}/);
        return {ok:true,status:200,json:async()=>({data:{viewer:identity}})};
      }
      if(opts.method==='GET') {
        if(String(url).endsWith('/user') && identity.userStatus) return {ok:false,status:identity.userStatus,json:async()=>{
          if(identity.badUserJson) throw new Error('invalid response');
          return {message:identity.userMessage};
        }};
        const body=String(url).includes('/comments?')?comments:identity;
        return {ok:true,status:200,json:async()=>body};
      }
      const body=JSON.parse(opts.body);
      writes.push({url:String(url),method:opts.method,...body});
      return {ok:true,status:200,json:async()=>({id:90,user:identity,...body})};
    }};
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),context,{filename,timeout:10000});
  const status=await done; assert.equal(status,0);
  return {writes,messages,requests};
}
function commentEnv829() {
  const e=env(fixture()), dir=tmp(); write(dir,'check.json',{fork:true,models:e.INPUT_MODELS,subjects:[],skipped:[]});
  return {...e,DRIFTPROOF_RECEIPTS:dir,GITHUB_TOKEN:'fixture',GITHUB_JOB:'check',GITHUB_ACTION:'driftproofhqdriftproof',
    GITHUB_WORKFLOW:'checks',GITHUB_WORKFLOW_REF:'example/repo/.github/workflows/checks.yml'+String.fromCharCode(64)+'refs/heads/main',GITHUB_RUN_ID:'100',GITHUB_RUN_ATTEMPT:'1'};
}
test('829 AC-5 comment lookup ignores foreign bots and humans before the token own bot', async () => {
  const e=commentEnv829(), first=await comment829(e);
  assert.equal(first.writes.length,1); assert.equal(first.writes[0].method,'POST');
  const body=first.writes[0].body;
  const foreign={id:11,body,user:{type:'Bot',login:'other-app[bot]'}};
  const human={id:12,body,user:{type:'User',login:'owned-app[bot]'}};
  const own={id:13,body,user:{type:'Bot',login:'owned-app[bot]'}};
  const edited=await comment829(e,[foreign,human,own]);
  assert.equal(edited.writes.length,1); assert.equal(edited.writes[0].method,'PATCH');
  assert.match(edited.writes[0].url,/comments\/13$/);
  const absent=await comment829(e,[foreign,human]);
  assert.ok(absent.writes.every(w=>w.method==='POST'),'no foreign author can authorize a PATCH');
  const unknown=await comment829(e,[foreign,own],{});
  assert.equal(unknown.writes.length,0,'unresolved identity never authorizes a write');
  assert.equal(unknown.messages.filter(s=>s.startsWith('::notice')).length,1);
});
test('829 AC-6 automatic markers separate jobs, invocations and workflows but survive later pushes', async () => {
  const e=commentEnv829(), first=await comment829(e);
  assert.equal(first.writes.length,1);
  const body=first.writes[0].body, marker=body.split('\n')[0];
  const own={id:13,body,user:{type:'Bot',login:'owned-app[bot]'}};
  for(const extra of [
    {GITHUB_JOB:'second-check'}, {GITHUB_ACTION:'driftproofhqdriftproof_2'},
    {INPUT_COMMENT_ID:'second-invocation'}, {DRIFTPROOF_COMMENT_MATRIX:'{"os":"linux"}'},
    {GITHUB_WORKFLOW:'other-checks',GITHUB_WORKFLOW_REF:e.GITHUB_WORKFLOW_REF.replace('checks.yml','other.yml')}
  ]) {
    const next=await comment829({...e,...extra},[own]);
    assert.equal(next.writes.length,1); assert.equal(next.writes[0].method,'POST');
    assert.notEqual(next.writes[0].body.split('\n')[0],marker);
  }
  const repeat=await comment829({...e,GITHUB_RUN_ID:'101',GITHUB_RUN_ATTEMPT:'2'},[own]);
  assert.equal(repeat.writes.length,1); assert.equal(repeat.writes[0].method,'PATCH');
  assert.match(repeat.writes[0].url,/comments\/13$/);
  assert.equal(repeat.writes[0].body.split('\n')[0],marker);
});

test('829 AC-5 explicit comments also require the token own bot login', async () => {
  const r=measured('NO_DIFFERENCE'), e={...commentEnv829(),INPUT_SKILL_DIR:'CLAUDE.md',INPUT_MODELS:r.run.model_id,DRIFTPROOF_RECEIPTS:set(r)};
  const first=await comment829(e); assert.equal(first.writes.length,1);
  const body=first.writes[0].body;
  const edited=await comment829(e,[
    {id:11,body,user:{type:'Bot',login:'other-app[bot]'}},
    {id:13,body,user:{type:'Bot',login:'owned-app[bot]'}}]);
  assert.equal(edited.writes.length,1); assert.equal(edited.writes[0].method,'PATCH');
  assert.match(edited.writes[0].url,/comments\/13$/);
});
test('829 AC-6 caller identity reaches the comment step and matrix order is stable', () => {
  const y=parseYaml(fs.readFileSync(path.join(ROOT,'action.yml'),'utf8'));
  assert.equal(y.inputs['comment-id'].default,'$'+'{{ github.action }}');
  const step=y.runs.steps.find(s=>String(s.run).includes('action/comment.sh'));
  assert.equal(step.env.INPUT_COMMENT_ID,'$'+'{{ inputs.comment-id }}');
  assert.equal(step.env.DRIFTPROOF_COMMENT_MATRIX,'$'+'{{ toJSON(matrix) }}');
  const e=commentEnv829();
  assert.equal(P().automaticMarker({...e,DRIFTPROOF_COMMENT_MATRIX:'{"os":"linux","node":22}'}),
    P().automaticMarker({...e,DRIFTPROOF_COMMENT_MATRIX:'{"node":22,"os":"linux"}'}));
  for(const field of ['GITHUB_WORKFLOW_REF','GITHUB_JOB','GITHUB_ACTION']) {
    const missing={...e,[field]:''}; if(field==='GITHUB_WORKFLOW_REF') delete missing.GITHUB_WORKFLOW;
    assert.throws(()=>P().automaticMarker(missing),/identity/i);
  }
});


// Issue 829, independent review round 2. Each correction has its own red plant.
for (const file of ['skills/a/evals/evals.json','skills/a/refs/x.md']) {
  test('829 R2 linked changed file alone still selects and refuses its enclosing skill: '+file, () => {
    const root=fixture(), e=env(root), outside=tmp();
    const target=write(outside,'target',file.endsWith('.json')?suite:'Outside reference.');
    write(root,file,'before'); fs.unlinkSync(path.join(root,file)); fs.symlinkSync(target,path.join(root,file));
    let calls=0;
    assert.throws(()=>P().run(e,{
      git:args=>args[0]==='rev-parse'?'a'.repeat(40):file+'\0',
      invoke:()=>{calls++;return {status:0,stdout:'',stderr:''};}
    }),/link/i,'SKILL.md is unchanged and absent from the change list');
    assert.equal(calls,0);
    assert.equal(fs.readdirSync(e.RUNNER_TEMP).length,0);
  });
}
for (const login of ['owned-app','owned-app[bot]']) {
  test('829 R2 bot comment updates with viewer login '+login, async () => {
    const e=commentEnv829(), identity={type:'Bot',login,...(login.endsWith('[bot]')?{}:{userStatus:403,userMessage:'Resource not accessible by integration'})};
    const first=await comment829(e,[],identity); assert.equal(first.writes.length,1);
    const body=first.writes[0].body;
    const next=await comment829(e,[
      {id:11,body,user:{type:'Bot',login:'other-app[bot]'}},
      {id:12,body,user:{type:'User',login:'owned-app[bot]'}},
      {id:13,body,user:{type:'Bot',login:'owned-app[bot]'}}
    ],identity);
    assert.equal(next.writes.length,1); assert.equal(next.writes[0].method,'PATCH');
    assert.match(next.writes[0].url,/comments\/13$/);
  });
}
// The real pr-check entry runs with only Git reads replaced. No repository
// mutation or provider invocation is needed to reach its key refusal.
function automaticKeys829(e) {
  const bin=tmp(), log=path.join(tmp(),'job-log'), calls=path.join(tmp(),'calls');
  const shim=[
    "const fs=require('node:fs');",
    "fs.appendFileSync(process.env.CALLS829,JSON.stringify(process.argv.slice(2))+'\\n');",
    "if(process.argv[2].endsWith('/bin/driftproof')) process.exit(91);",
    "const cp=require('node:child_process');",
    "cp.execFileSync=(cmd,args)=>{if(cmd!=='git')throw Error('unexpected executable');return args[0]==='rev-parse'?'a'.repeat(40):'CLAUDE.md\\0';};",
    "process.stdout.write('::error title=Untrusted::forged\\n');",
    "process.argv.splice(1,1); require('node:module').runMain();"
  ].join('\n');
  write(bin,'node','#!'+process.execPath+'\n'+shim); fs.chmodSync(path.join(bin,'node'),0o755);
  const fd=fs.openSync(log,'w'); let r;
  try { r=spawnSync('bash',[path.join(ROOT,'action/run.sh')],{cwd:e.GITHUB_WORKSPACE,
    env:{...e,PATH:bin+path.delimiter+e.PATH,CALLS829:calls},stdio:['ignore',fd,fd],timeout:1800000}); }
  finally { fs.closeSync(fd); }
  assert.ifError(r.error);
  return {status:r.status,text:fs.readFileSync(log,'utf8'),calls:fs.readFileSync(calls,'utf8')};
}
for (const [model,missing,other] of [
  ['claude-haiku-5-5','ANTHROPIC_API_KEY','OPENAI_API_KEY'],
  ['gpt-5.6-sol','OPENAI_API_KEY','ANTHROPIC_API_KEY']
]) {
  test('829 R2 automatic missing '+missing+' reaches the active job log', () => {
    const e={...env(fixture()),INPUT_MODELS:model,[other]:'private-fixture-value-829'};
    delete e.DRIFTPROOF_STUB;
    const r=automaticKeys829(e), parsed=activeCommands829(r.text);
    assert.notEqual(r.status,0); assert.equal(parsed.stopped,null);
    assert.equal(parsed.active.length,1);
    assert.match(parsed.active[0],new RegExp('^::error title=Driftproof::.*'+missing));
    assert.match(parsed.active[0],/Automatic mode never falls back to a subscription login/);
    assert.doesNotMatch(parsed.active[0],/forged|Untrusted/);
    assert.doesNotMatch(r.text,/private-fixture-value-829/);
    assert.doesNotMatch(r.calls,/\/bin\/driftproof/);
    assert.equal(fs.readdirSync(e.RUNNER_TEMP).length,0);
  });
}

test('829 R2 failed account lookup retains one notice and never edits', async () => {
  const e=commentEnv829();
  for (const userStatus of [401,404,500]) {
    const next=await comment829(e,[],{type:'Bot',login:'owned-app',userStatus});
    assert.equal(next.writes.length,0);
    assert.equal(next.messages.filter(s=>s.startsWith('::notice')).length,1);
  }
});


// Issue 829, round 3: restore bot-only ownership and skip linked ancestors.
test('829 R3 a User token posts again even beside its own User comment', async () => {
  const e=commentEnv829(), identity={type:'User',login:'owned-user'};
  const first=await comment829(e,[],identity); assert.equal(first.writes.length,1);
  const body=first.writes[0].body;
  const comments=[
    {id:11,body,user:{type:'Bot',login:'owned-user[bot]'}},
    {id:13,body,user:{type:'User',login:'owned-user'}}
  ];
  for(let push=0;push<2;push++) {
    const next=await comment829(e,comments,identity);
    assert.equal(next.writes.length,1); assert.equal(next.writes[0].method,'POST');
    assert.equal(next.messages.filter(s=>s.startsWith('::notice')).length,0);
    comments.push({id:14+push,body:next.writes[0].body,user:{type:'User',login:'owned-user'}});
  }
});
test('829 R3 an ambiguous 403 never turns a User token into a Bot', async () => {
  const e=commentEnv829(), seed=await comment829(e);
  const body=seed.writes[0].body;
  const comments=[
    {id:11,body,user:{type:'Bot',login:'owned-user[bot]'}},
    {id:13,body,user:{type:'User',login:'owned-user'}}
  ];
  for(const extra of [{},{userMessage:'API rate limit exceeded'},{userMessage:'Forbidden'},{badUserJson:true}]) {
    const next=await comment829(e,comments,{type:'User',login:'owned-user',userStatus:403,...extra});
    assert.equal(next.writes.length,1); assert.equal(next.writes[0].method,'POST');
  }
});
test('829 R3 only positive integration evidence lets an unsuffixed viewer edit a Bot', async () => {
  const e=commentEnv829(), identity={type:'Bot',login:'owned-app',userStatus:403,userMessage:'Resource not accessible by integration'};
  const first=await comment829(e,[],identity), body=first.writes[0].body;
  const comments=[{id:11,body,user:{type:'Bot',login:'other-app[bot]'}},{id:13,body,user:{type:'Bot',login:'owned-app[bot]'}}];
  const next=await comment829(e,comments,identity);
  assert.equal(next.writes.length,1); assert.equal(next.writes[0].method,'PATCH');
  assert.match(next.writes[0].url,/comments\/13$/);
});
test('829 R3 a linked directory and its removed child do not hide independent subjects', () => {
  const root=fixture(), e=env(root), outside=fixture();
  write(outside,'SKILL.md','# Outside skill\n');
  write(root,'docs/placeholder','regular'); fs.symlinkSync(outside,path.join(root,'docs/old'));
  const changed=['docs/old','docs/old/a.md','CLAUDE.md'];
  const found=P().discover(root,changed);
  assert.deepEqual(found.filter(s=>!s.reason).map(s=>s.file),['CLAUDE.md']);
  assert.deepEqual(found.filter(s=>s.reason).map(s=>s.file),['docs/old','docs/old/a.md']);
  const out=P().run(e,{git:args=>args[0]==='rev-parse'?'a'.repeat(40):changed.join('\0')+'\0'});
  const manifest=JSON.parse(fs.readFileSync(path.join(out,'check.json')));
  assert.deepEqual(manifest.subjects.map(s=>s.file),['CLAUDE.md']);
  assert.deepEqual(manifest.skipped.map(s=>s.file),['docs/old','docs/old/a.md']);
  assert.equal(P().result(out,e).fails,false);
  const summary=fs.readFileSync(e.GITHUB_STEP_SUMMARY,'utf8');
  for(const file of changed.slice(0,2)) assert.ok(summary.includes('Not measured: '+file+', symbolic link.'));
});
test('829 R3 a linked inner directory still selects and refuses its real enclosing skill', () => {
  const root=fixture(), e=env(root);
  fs.symlinkSync(tmp(),path.join(root,'skills/a/refs'));
  const changed=['skills/a/refs','skills/a/refs/x.md']; let calls=0;
  assert.throws(()=>P().run(e,{
    git:args=>args[0]==='rev-parse'?'a'.repeat(40):changed.join('\0')+'\0',
    invoke:()=>{calls++;throw new Error('runner called');}
  }),/link/i);
  assert.equal(calls,0); assert.equal(fs.readdirSync(e.RUNNER_TEMP).length,0);
});
test('829 R3 skipping an unrelated link cannot hide a linked ancestor SKILL.md', () => {
  const root=fixture(), target=write(tmp(),'target','# Rules\n');
  fs.symlinkSync(target,path.join(root,'SKILL.md'));
  fs.symlinkSync(tmp(),path.join(root,'unrelated-link'));
  assert.throws(()=>P().discover(root,['unrelated-link']),/link/i);
});
