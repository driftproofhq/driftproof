// SPDX-License-Identifier: Apache-2.0
'use strict';
// Issue 820. Discovery and a receipt table for one entire pull request. No model
// reading is stored in the manifest: every consumer re-reads the sealed receipts.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const { isRulesFile } = require('../lib/rules-files');
const { loadSubject } = require('../lib/skill');
const { listReceipts, validateReceipt, verifyReceiptHash } = require('../lib/receipt');
const { readingOf } = require('../lib/reading-words');
const { placeboReading, githubOutputEntry } = require('../lib/verdict');
const decision = require('../lib/decision');
const { mdText } = require('../lib/names');
const { providerForModel } = require('../lib/models');
const { resolveModel } = require('../lib/provider');
const { shortModelName } = require('../scripts/model-names');
const FORK_LINE = 'not measured on forks: GitHub gives fork pull requests no secrets';
const MARKER = '<!-- driftproof:pull-request-check -->';
const options = env => ({failOnRegression:env.INPUT_FAIL_ON_REGRESSION !== 'false', failOnUnderpowered:env.INPUT_FAIL_ON_UNDERPOWERED === 'true', failOnFake:env.INPUT_FAIL_ON_FAKE === 'true'});

// Stable across pushes and retries, separate for every caller and matrix job.
function automaticMarker(env) {
  const workflow=env.GITHUB_WORKFLOW_REF || env.GITHUB_WORKFLOW;
  const invocation=env.INPUT_COMMENT_ID || env.GITHUB_ACTION;
  if (!workflow || !env.GITHUB_JOB || !invocation) throw new Error('Automatic comment identity is missing');
  const canonical=value => Array.isArray(value) ? value.map(canonical)
    : value && typeof value==='object' ? Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])) : value;
  const matrix=canonical(JSON.parse(env.DRIFTPROOF_COMMENT_MATRIX || 'null'));
  const key=createHash('sha256').update(JSON.stringify([workflow,env.GITHUB_JOB,invocation,matrix])).digest('hex');
  return MARKER.replace(' -->',' '+key+' -->');
}
class MissingApiKey extends Error {
  constructor(provider, message) {
    super(message);
    // Reserved for the automatic shell entry. No child status is forwarded.
    this.exitCode=provider==='anthropic' ? 78 : 79;
  }
}

function safePath(root, rel) {
  if (typeof rel !== 'string' || !rel || path.isAbsolute(rel) || /[\x00-\x1f\x7f\\]/.test(rel) || rel.split('/').some(p => !p || p === '..' || p === '.')) throw new Error('Invalid repository path');
  let at = root;
  for (const part of rel.split('/')) {
    at = path.join(at,part);
    try { if (fs.lstatSync(at).isSymbolicLink()) throw Object.assign(new Error('Linked repository path refused'),{code:'LINKED_PATH'}); }
    catch (e) { if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return path.join(root,rel); throw e; }
  }
  return at;
}
function regular(root, rel) {
  const full=safePath(root,rel);
  try { return fs.lstatSync(full).isFile(); } catch (e) { if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return false; throw e; }
}
function discover(root, changed) {
  const files=new Set(), skipped=new Map();
  for (const file of changed) {
    // Validate before deciding whether this path is a subject. Only a link
    // refusal can become a skip; invalid paths and measured links still fail.
    try { safePath(root,file); }
    catch (e) {
      if (e.code!=='LINKED_PATH' || isRulesFile(file) || path.posix.basename(file)==='SKILL.md') throw e;
      skipped.set(file,{file,reason:'symbolic link'});
      // The parent walk only checks SKILL.md paths. A linked suite or bundled
      // file must still select its enclosing skill for the normal refusal.
    }
    if (isRulesFile(file) || path.posix.basename(file)==='SKILL.md') files.add(file);
    let parent=path.posix.dirname(file);
    // A removed child may now sit below a directory replaced by a link.
    // Skip those ancestor paths without probing inside the link target.
    if (skipped.has(file)) while (parent!=='.') {
      try { safePath(root,parent); break; }
      catch (e) { if (e.code!=='LINKED_PATH') throw e; }
      parent=path.posix.dirname(parent);
    }
    while (true) {
      const skill=parent==='.' ? 'SKILL.md' : parent+'/SKILL.md';
      if (regular(root,skill)) files.add(skill);
      if (parent==='.') break;
      parent=path.posix.dirname(parent);
    }
  }
  return [...files].sort().map(file => {
    const skill=path.posix.basename(file)==='SKILL.md';
    const folder=path.posix.dirname(file);
    const suite=path.posix.join(folder,'evals/evals.json');
    const subject=skill ? folder : file;
    if (!regular(root,file)) return {file,subject,reason:'deleted'};
    if (!regular(root,suite)) return {file,subject,reason:'no test cases'};
    return {file,subject,...(!skill ? {suite} : {})};
  }).concat([...skipped.values()]).sort((a,b)=>a.file.localeCompare(b.file));
}
function requireKeys(env) {
  if (env.DRIFTPROOF_STUB==='1') return;
  for(const model of decision.parseModels(env.INPUT_MODELS)) {
    const provider=providerForModel(model);
    if (provider==='anthropic' && !env.ANTHROPIC_API_KEY) throw new MissingApiKey('anthropic','ANTHROPIC_API_KEY is missing: set the api-key input for Anthropic models. '+(env.INPUT_SKILL_DIR ? 'Explicit' : 'Automatic')+' mode never falls back to a subscription login.');
    if (provider==='openai' && !env.OPENAI_API_KEY) throw new MissingApiKey('openai','OPENAI_API_KEY is missing: set the openai-api-key input for OpenAI models. '+(env.INPUT_SKILL_DIR ? 'Explicit' : 'Automatic')+' mode never falls back to a subscription login.');
  }
}
function readSet(dir, models, opts={}, expected=null) {
  const entries=listReceipts(dir);
  for(const {receipt:r} of entries) {
    if (!r) throw new Error('Unreadable receipt');
    if (!verifyReceiptHash(r)) throw new Error('Receipt hash does not verify');
    if (!validateReceipt(r).valid) throw new Error('Receipt schema does not verify');
    if (expected && (r.skill.content_hash!==expected.contentHash || r.suite.suite_hash!==expected.suiteHash)) throw new Error('Receipt identity differs from the selected file or test cases');
  }
  const d=decision.decideSet(dir,models,opts);
  if (!d.rows.length || d.missing.length || d.unexpected.length || d.receiptCount!==d.requestedCount) throw new Error('Missing, duplicate or unexpected receipt');
  const rows=d.rows.map(row => {
    const r=entries.find(e=>path.basename(e.file)===row.file).receipt;
    const reading=readingOf(r), fake=!!r.placebo;
    const measured=reading.text!==null && row.state!=='not measured';
    const loss=reading.reading==='BELOW_PLACEBO';
    const causes=[];
    if (decision.failsJob(row,opts)) causes.push(row.state==='regression' ? 'a regression (fail-on-regression is on)' : 'not enough evidence (fail-on-underpowered is on)');
    if (opts.failOnFake && loss) causes.push('a loss to the fake (fail-on-fake is on)');
    return {...row,decisionDelta:row.delta,reading:reading.text || 'not measured',measured,hash:r.receipt_hash,
      delta:measured ? r.comparison.delta : null,
      fakeDelta:fake && measured ? placeboReading(r).figures?.comparison.delta ?? null : null,
      fake,causes};
  });
  return {rows,fails:rows.some(r=>r.causes.length),causes:[...new Set(rows.flatMap(r=>r.causes))]};
}
function modelName(id) { try { return shortModelName(id); } catch { return id; } }
function collect(manifest,dir,opts) {
  let refused=false;
  const rows=[],causes=[],skipped=[...(manifest.skipped||[])];
  for(const s of manifest.subjects) {
    try {
      if(s.error) throw new Error('The run could not finish');
      const set=readSet(safePath(dir,s.dir),manifest.models,opts,s.contentHash ? s : null);
      rows.push(...set.rows.map(r=>({...r,subject:s.file})));
      causes.push(...set.causes);
    } catch {
      refused=true;
      causes.push('a run or receipt could not be verified');
      skipped.push({file:s.file,reason:'the run or receipt could not be verified'});
    }
  }
  return {rows,causes:[...new Set(causes)],skipped,refused,fails:causes.length>0};
}
function number(n) { return typeof n==='number' && Number.isFinite(n) ? (n<0 ? '−' : '+')+Math.abs(n).toFixed(2) : 'not measured'; }
function render(manifest,dir,opts={},runUrl=null) {
  if(manifest.fork) return FORK_LINE+'\n';
  const r=collect(manifest,dir,opts);
  const measured=new Set(r.rows.filter(x=>x.measured).map(x=>x.subject)).size;
  const names=[...new Set(r.rows.map(x=>modelName(x.model)))].map(mdText).join(', ');
  const lines=[`Driftproof · ${measured} changed ${measured===1?'file':'files'} measured${names?' · '+names:''}`, '',
    '| File | Model | Change vs without | Change vs fake | Reading | Receipt |',
    '| --- | --- | --- | --- | --- | --- |'];
  const url=runUrl && /^https:\/\/[\w.-]+\/[^\s()<>]+$/.test(runUrl) ? runUrl+'#artifacts' : null;
  for(const row of r.rows) {
    const hash=row.hash.slice(0,8), link=url ? `[${hash}](${url})` : hash;
    lines.push(`| ${mdText(row.subject)} | ${mdText(modelName(row.model))} | ${number(row.delta)} | ${row.fake ? number(row.fakeDelta) : 'not run'} | ${row.reading} | ${link} |`);
  }
  if(!manifest.subjects.length && !r.skipped.length) lines.push('', 'No changed skills or rules files.');
  for(const s of r.skipped) lines.push('', `Not measured: ${mdText(s.file)}, ${s.reason==='no test cases' ? 'which has no test cases (npx driftproof init makes them for a skill folder).' : s.reason+'.'}`);
  if(r.rows.some(x=>!x.measured)) lines.push('', 'Not measured rows support no result. Stub receipts measure nothing.');
  if(r.rows.length) lines.push('', 'These tasks, these models, this run. Changes are average scores; the reading checks each task. Rules files are measured as always-on text, without the editor’s rule selection.');
  lines.push('', `Check result: ${r.fails ? 'failed, '+r.causes.join('; ') : measured ? 'no selected failure found' : 'not measured'}. This comment updates on each push.`);
  return lines.join('\n')+'\n';
}
function result(dir,env) {
  const manifest=JSON.parse(fs.readFileSync(path.join(dir,'check.json'),'utf8'));
  return manifest.fork ? {fails:false,rows:[],causes:[]} : collect(manifest,dir,options(env));
}
function run(env=process.env, deps={}) {
  const root=env.GITHUB_WORKSPACE || process.cwd();
  const ev=JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH,'utf8'));
  const pr=ev.pull_request;
  if(env.GITHUB_EVENT_NAME!=='pull_request' || !pr?.head?.repo?.full_name || !pr?.base?.repo?.full_name || !/^[a-f0-9]{40,64}$/.test(pr.head.sha) || !/^[a-f0-9]{40,64}$/.test(pr.base.sha) || pr.base.repo.full_name!==env.GITHUB_REPOSITORY) throw new Error('Pull request event identity is missing');
  const manifest={models:decision.parseModels(env.INPUT_MODELS).map(resolveModel).join(','),subjects:[],skipped:[]};
  if(pr.head.repo.full_name!==pr.base.repo.full_name) manifest.fork=true;
  else {
    if(env.INPUT_SUITE || env.INPUT_COMPARE_WITH_BASE==='true') throw new Error('suite and compare-with-base need an explicit skill-dir');
    const git=deps.git || (args=>execFileSync('git',args,{cwd:root,encoding:'utf8',timeout:60000,maxBuffer:16*1024*1024}));
    if(git(['rev-parse','HEAD']).trim()!==pr.head.sha) throw new Error('Checkout HEAD differs from the pull request head');
    const changed=git(['diff','--no-ext-diff','--no-textconv','--name-only','--no-renames','-z',pr.base.sha+'...'+pr.head.sha,'--']).split('\0').filter(Boolean);
    const found=discover(root,changed);
    manifest.skipped=found.filter(s=>s.reason);
    const subjects=found.filter(s=>!s.reason);
    if(subjects.length) requireKeys(env);
    const count=subjects.length;
    // Round down so allocated budgets cannot sum above the input.
    const maxUsd=Math.floor(Number(env.INPUT_MAX_USD)*1e6/Math.max(1,count))/1e6;
    const maxCalls=Math.floor(Number(env.INPUT_MAX_CALLS)/Math.max(1,count));
    if(count && (!(maxUsd>0) || !(maxCalls>0))) throw new Error('The budget is too small for the changed files');
    manifest.subjects=subjects.map((s,i)=>{
      const subject=loadSubject(path.join(root,s.subject),s.suite ? {suite:safePath(root,s.suite)} : {});
      return {...s,dir:'subject-'+i,contentHash:subject.contentHash,suiteHash:subject.suite.suiteHash,maxUsd,maxCalls};
    });
  }
  const out=fs.mkdtempSync(path.join(env.RUNNER_TEMP,'driftproof-receipts.'));
  const scratch=fs.mkdtempSync(path.join(env.RUNNER_TEMP,'driftproof-check.'));
  try {
    for(const s of manifest.subjects) {
      const output=path.join(scratch,'output'); fs.writeFileSync(output,'');
      const childEnv={...env,INPUT_SKILL_DIR:path.join(root,s.subject),INPUT_SUITE:s.suite ? path.join(root,s.suite) : '',
        INPUT_MAX_USD:String(s.maxUsd),INPUT_MAX_CALLS:String(s.maxCalls),INPUT_MODELS:manifest.models,
        INPUT_COMPARE_WITH_BASE:'false',GITHUB_OUTPUT:output,GITHUB_STEP_SUMMARY:'',CLAUDE_PROVIDER:'api',OPENAI_SURFACE:'api'};
      // Child run.sh retains the existing validators, empty cwd, output fence and runner.
      const invoke=deps.invoke || ((e)=>spawnSync('bash',[path.join(env.GITHUB_ACTION_PATH,'action/run.sh')],{cwd:root,env:e,encoding:'utf8',timeout:1800000,maxBuffer:16*1024*1024}));
      const r=invoke(childEnv);
      // Child output can contain untrusted case text. The shell entry fences this stream.
      if(r.stdout) process.stdout.write(r.stdout);
      if(r.stderr) process.stderr.write(r.stderr);
      const text=fs.readFileSync(output,'utf8');
      const match=/^receipts_dir<<(\S+)\n([^\n]+)\n\1$/m.exec(text);
      if(r.status!==0 || !match) s.error=true;
      if(match) fs.renameSync(match[2],path.join(out,s.dir));
      else fs.mkdirSync(path.join(out,s.dir));
    }
    fs.writeFileSync(path.join(out,'check.json'),JSON.stringify(manifest,null,2)+'\n');
    const r=result(out,env), worst=decision.worstState([...r.rows.map(x=>x.state),...(r.refused?['refused']:[])]) || 'not measured';
    const values={receipts_dir:out,artifact_name:path.basename(out),verdict:decision.VERDICT_WORD[worst],delta:'n/a',worst_state:worst,
      regressed_models:[...new Set(r.rows.filter(x=>x.state==='regression').map(x=>x.model))].join(','),missing_models:r.refused ? manifest.models : '',receipt_count:String(r.rows.length),draws_needed:''};
    const worstRow=r.rows.find(x=>x.state===worst); if(worstRow?.decisionDelta!=null) values.delta=String(worstRow.decisionDelta);
    fs.appendFileSync(env.GITHUB_OUTPUT,Object.entries(values).map(([k,v])=>githubOutputEntry(k,v)).join('\n')+'\n');
    if(env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY,render(manifest,out,options(env),runUrl(env)));
    return out;
  } finally { fs.rmSync(scratch,{recursive:true,force:true}); }
}
function runUrl(env) { return env.GITHUB_SERVER_URL && env.GITHUB_RUN_ID ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : null; }
function singleManifest(env) { return {models:decision.parseModels(env.INPUT_MODELS).map(resolveModel).join(','),subjects:[{file:env.INPUT_SKILL_DIR,dir:'receipts'}],skipped:[]}; }
function single(env) { return readSet(env.DRIFTPROOF_RECEIPTS,decision.parseModels(env.INPUT_MODELS).map(resolveModel).join(','),options(env)); }
function singleMarkdown(env) {
  // Render the same directory without copying or re-sealing any receipt.
  const m=singleManifest(env), parent=path.dirname(env.DRIFTPROOF_RECEIPTS);
  m.subjects[0].dir=path.basename(env.DRIFTPROOF_RECEIPTS);
  return render(m,parent,options(env),runUrl(env));
}
if(require.main===module) {
  try {
    const env=process.env, mode=process.argv[2];
    if(mode==='run') run(env);
    else if(mode==='keys') requireKeys(env);
    else if(mode==='summary') fs.appendFileSync(env.GITHUB_STEP_SUMMARY,singleMarkdown(env));
    else if(mode==='enforce') {
      const r=env.INPUT_SKILL_DIR==='' ? result(env.DRIFTPROOF_RECEIPTS,env) : single(env);
      console.log(r.fails ? 'Driftproof check failed: '+r.causes.join('; ') : 'Driftproof: no selected failure found. Unmeasured rows are not a pass.');
      process.exitCode=r.fails ? 1 : 0;
    } else throw new Error('Unknown check operation');
  } catch (e) {
    // Only fixed key diagnostics may leave the validation boundary. Never echo
    // arbitrary event, receipt, path or provider text into an annotation.
    console.error('::error title=Driftproof::'+(e instanceof MissingApiKey ? e.message : 'The check could not verify its inputs or receipts.'));
    process.exitCode=process.argv[2]==='run' && e instanceof MissingApiKey ? e.exitCode : 1;
  }
}
module.exports={automaticMarker,discover,readSet,render,result,run,requireKeys,options,runUrl,singleMarkdown,FORK_LINE,MARKER};
