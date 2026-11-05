#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';
// Site builder: {"href":"/tasks/","label":"Every task we gave a skill"}
// Issue 703. Only existing suites and report readers supply task content.
// Issue 707: the marker above registers /tasks/ with scripts/reader-pages.js, so the footer, the home
// door, README.md, llms.txt and llms-full.txt list it like the other reader pages. A page's description
// is derived from its first paragraphs (spec 020 AC-14), so the breadcrumb is a nav, not a paragraph,
// and each skill page's lede names its skill: twenty pages no longer ship one description between them.
const fs = require('node:fs');
const path = require('node:path');
const { sha256 } = require('../lib/canonical');
const { suiteIdentity } = require('../lib/skill');
const { verifyReceiptHash, validateReceipt } = require('../lib/receipt');
const S = require('./sugar-pill-page');
const { STATE_WORDS } = require('./how-it-works');
const { humanModelName } = require('./model-names');
const ROOT = path.join(__dirname, '..');
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const need = (ok, code) => { if (!ok) throw new Error(code); };
const href = s => '/tasks/' + s.repository + '/' + s.name + '/';
const planPath = n => 'receipts/report-' + (n === '017' ? '017c' : n) + '/plan.json';
const read = p => fs.readFileSync(path.join(ROOT,p),'utf8');
const plans = Object.fromEntries(['017','018'].map(n=>[n,JSON.parse(read(planPath(n)))]));
const fig = (v,src,at) => '<data value="'+esc(v)+'" data-src="'+esc(src)+'" data-at="'+esc(at)+'" data-fn="source field" data-dp="exact">'+esc(v)+'</data>';

function bindSuite(bytes,m) {
  const p=m.row.attempt.protocol;
  need(sha256(bytes)===p.evals_sha256,'SUITE_BINDING: bytes');
  const raw=JSON.parse(bytes), normalized=suiteIdentity(raw);
  need(normalized.suiteHash===p.suite_hash && normalized.suiteHash===m.receipt.suite.suite_hash,'SUITE_BINDING: identity');
  need(verifyReceiptHash(m.receipt) && validateReceipt(m.receipt).valid,'RECEIPT_BINDING');
  need(raw.repository===p.repository && raw.skill_sha256===p.skill_sha256 && raw.skill_path===p.skill_path && raw.commit===p.commit,'SUITE_BINDING: source');
  need(raw.author==='Driftproof' && raw.cases.length===m.receipt.suite.case_count && raw.scope,'SUITE_BINDING: scope');
  const plan=plans[m.report], attempt=plan.execution.attempts.find(a=>a.attempt_id===m.row.attempt_id);
  need(attempt && JSON.stringify(attempt.protocol)===JSON.stringify(p),'PLAN_BINDING');
  need(plan.samples===p.samples && plan.samples===m.receipt.run.judge.samples,'PLAN_BINDING: samples');
  for(const c of raw.cases) need(typeof c.prompt==='string' && typeof c.rubric==='string' && typeof c.origin==='string' && Number.isFinite(c.pass_threshold),'SUITE_BINDING: task');
  return raw;
}
function translateLine(line) {
  let replaced=false;
  const out=line.replace(/^(.*?) \(([^)]+)\):/,(_,id,state)=>{
    need(Object.hasOwn(STATE_WORDS,state),'STATE_WORDS: '+state);replaced=true;
    return id+' ('+STATE_WORDS[state]+'):';
  });
  need(replaced,'STATE_WORDS: missing state');return out;
}
// Keep the report's HTML data provenance and all its words; swap just the state.
function taskLine(rowHTML,id,kind) {
  const list=new RegExp('<ul class="'+kind+'-tasks">([\\s\\S]*?)</ul>').exec(rowHTML);
  if(!list) return null;
  const hit=[...list[1].matchAll(/<li data-task="([^"]+)">([\s\S]*?)<\/li>/g)].find(x=>x[1]===esc(id));
  need(hit,'TASK_BINDING');return translateLine(hit[2]);
}
let cached;
function data() {
  if(cached)return cached;
  cached=S.skillsOf().map(s=>{
    const measurements=s.measurements.map(m=>{
      const src='docs/skills/receipts/issue-408/suites/'+m.row.attempt.protocol.evals_sha256+'.json';
      const suite=bindSuite(fs.readFileSync(path.join(ROOT,src)),m);
      const rowHTML=require('./prepare-report-'+m.report).rowHTML(m.row);
      return {...m,srcSuite:src,suite,rowHTML,plan:plans[m.report],caveats:S.caveatsOf(m.report)};
    });
    need(measurements.every(m=>JSON.stringify(m.suite)===JSON.stringify(measurements[0].suite)),'SUITE_BINDING: reports disagree');
    return {...s,measurements,suite:measurements[0].suite};
  });
  return cached;
}
const available = url => fs.existsSync(path.join(ROOT,'docs',url.split('#')[0],'index.html'));
function related(s,m) {
  const report='/reports/'+m.report+'/';
  const rowLink=report+'#each-skill:~:text='+encodeURIComponent(s.name+' '+s.repository);
  const links=[['/r/'+m.hash+'/','See the receipt'],[rowLink,'Read this report row'],['/sugar-pill/#skill-'+s.name,'See the sugar pill comparison']];
  const perSkill=report+'blind/'+s.repository+'/'+s.name+'/';
  if(available(perSkill))links.push([perSkill,'Can you tell which answer had the skill?']);
  else if(m.report==='017' && S.blindSkill()===s.name) links.push([report+'blind/','Can you tell which answer had the skill?']);
  // Notes are optional. Only link a panel that the report row actually contains.
  const notes=/id="([^"]*(?:judge|grading)[^"]*)"/.exec(m.rowHTML);
  if(notes)links.push([report+'#'+notes[1],"Read the judge’s notes"]);
  return links.map(([url,label])=>'<a href="'+esc(url)+'">'+esc(label)+'</a>').join('');
}
function result(s,t,m) {
  const fake=taskLine(m.rowHTML,t.id,'placebo'),none=taskLine(m.rowHTML,t.id,'verdict');
  need(fake && (none || m.router),'TASK_BINDING');
  const router=/<p class="router-qualification">([\s\S]*?)<\/p>/.exec(m.rowHTML);
  const note=m.row.handoffNote?'<p class="handoff-note">'+esc(m.row.handoffNote)+'</p>':'';
  return '<details class="task-report" data-report="'+m.report+'"><summary><span class="task-model">'+esc(humanModelName(m.model))+'</span><span>Report '+m.report+' · Read the task result</span></summary>'+
    '<div class="task-report-body"><p class="task-comparison-label">Against the same-length fake</p><p class="task-fake">'+fake+'</p>'+
    (none?'<p class="task-comparison-label">Against nothing</p><p class="task-none">'+none+'</p>':'<p>The report omits the comparison against nothing for this router.</p>')+
    (router?'<p class="router-qualification">'+router[1].replace('Report 015 Amendment 1',fig('Report 015 Amendment 1','docs/reports/015/index.html','amendment-1'))+'</p>':'')+note+
    '<ul class="task-caveats">'+m.caveats.map(p=>'<li><strong>'+esc(p.lead)+'</strong> '+esc(p.text)+'</li>').join('')+'</ul>'+
    '<p class="task-method">Driftproof collected several answers per arm. A judge model scored each answer <span data-samples>'+fig(m.plan.samples,planPath(m.report),'samples')+'</span> times.</p>'+
    '<nav class="task-links" aria-label="'+esc(t.id+' Report '+m.report+' sources')+'">'+related(s,m)+'</nav></div></details>';
}
function task(s,t) {
  const src=s.measurements[0].srcSuite;
  // Splitting before each numbered criterion keeps the leading space in that
  // span. Concatenated textContent is still the exact source rubric.
  const rubric=t.rubric.split(/(?= [1-9]\d*\. [A-Z])/).map(part=>'<span>'+esc(part)+'</span>').join('');
  return '<section class="task" id="'+esc(t.id)+'"><header class="task-heading"><p class="task-eyebrow">The task</p><h2 data-source-text>'+esc(t.id)+'</h2><a href="#'+esc(t.id)+'">Link to this task</a></header>'+
    '<p class="task-scope" data-source-text>'+esc(s.suite.scope)+'</p>'+
    '<div class="task-prompt-panel"><h3>What we asked</h3><pre data-copy-source="prompt" data-source-text>'+esc(t.prompt)+'</pre></div>'+
    '<details class="task-guide" open><summary>The scoring guide</summary><div data-copy-source="rubric" data-source-text>'+rubric+'</div><p>Pass threshold: <span data-pass>'+fig(t.pass_threshold,src,'cases.'+t.id+'.pass_threshold')+'</span>.</p></details>'+
    '<p class="task-origin" data-source-text>'+esc(t.origin)+'</p>'+
    '<section class="task-try"><h3>Try it yourself</h3><p>Paste the prompt into your own assistant, with or without the skill. Use the scoring guide to read the answer.</p><div class="task-copy-actions"><button type="button" data-copy="prompt" hidden>Copy prompt</button><button type="button" data-copy="rubric" hidden>Copy scoring guide</button></div><p>One try scored by hand is not a measurement.</p>'+s.measurements.map(m=>'<p class="task-method">Report '+m.report+': several answers per arm, each scored '+fig(m.plan.samples,planPath(m.report),'samples')+' times by a judge model. The report’s findings and caveats are below.</p>').join('')+'<p class="task-copy-note">Copying stays in your browser. Copies are never stored, counted or sent anywhere by Driftproof.</p></section>'+
    '<section class="task-results"><h3>What happened on this task</h3><p>Open a report to read its comparison and limits together. Beating the fake is not beating no skill.</p>'+s.measurements.map(m=>result(s,t,m)).join('')+'</section></section>';
}
function skillMain(s) {
  return '<main class="tasks-page" data-island="tasks"><nav class="task-breadcrumb" aria-label="Breadcrumb"><a href="/tasks/">All skill tests</a></nav><header class="tasks-hero"><p class="task-eyebrow">Read the test. Try the question.</p><h1>'+esc(s.name)+'</h1><p class="lede">The prompts and scoring guides used to test '+esc(s.name)+', with each report’s findings and limits.</p><p class="task-repo">'+esc(s.repository)+'</p><p class="task-description">'+esc(S.typography(s.description))+'</p><p><a href="/skills/'+esc(s.repository+'/'+s.name)+'/">About this skill and its measurements</a></p></header>'+
    (s.measurements.some(m=>m.router)?'<aside class="task-qualification"><p>'+esc(s.measurements.find(m=>m.router).plan.routers.qualification)+'</p></aside>':'')+
    '<nav class="task-jumps" aria-label="Tasks in suite order">'+s.suite.cases.map(t=>'<a data-source-text href="#'+esc(t.id)+'">'+esc(t.id)+'</a>').join('')+'</nav><p class="task-status" role="status" aria-live="polite"></p>'+s.suite.cases.map(t=>task(s,t)).join('\n')+
    '<footer class="task-source"><h2>Where the test comes from</h2><p>These are Driftproof-authored text tasks, not an author-supplied benchmark. The published suite is bound to each report’s sealed receipt.</p><a href="/'+s.measurements[0].srcSuite.replace(/^docs\//,'')+'">Read the original suite</a><p><a href="/tasks/">Browse another skill’s test</a></p></footer></main>';
}
function indexMain() {
  return '<main class="tasks-page"><header class="tasks-hero"><p class="task-eyebrow">An open test book</p><h1>Every task we gave a skill</h1><p class="lede">See the exact question. Read the scoring guide. Try it in your own assistant.</p><p>Driftproof wrote these text tasks from each pinned skill and README. They are not author-supplied benchmarks. Find a skill below, then go straight to a task.</p><p>Skills are alphabetical. Tasks stay in the order of their original suite.</p></header><div class="task-index-grid">'+data().map(s=>'<article class="task-index-card"><p class="task-repo">'+esc(s.repository)+'</p><h2><a href="'+esc(href(s))+'">'+esc(s.name)+'</a></h2><p class="task-description">'+esc(S.typography(s.description))+'</p><nav class="task-jumps" aria-label="'+esc(s.name)+' tasks">'+s.suite.cases.map(t=>'<a href="'+esc(href(s)+'#'+t.id)+'">'+esc(t.id)+'</a>').join('')+'</nav></article>').join('\n')+'</div></main>';
}
function targets(shell) {
  const wrap=(title,description,main)=>shell({title:title+' | Driftproof',description,main,head:'<link rel="stylesheet" href="/tasks/style.css">\n'});
  return {
    'tasks/index.html':()=>wrap('Every task we gave a skill','Read the exact prompts and scoring guides used to test popular AI skills. Copy a task, try it yourself, and see the existing reports’ findings and limits.',indexMain()),
    ...Object.fromEntries(plans['017'].rows.map(r=>['tasks/'+r.repository+'/'+r.skill+'/index.html',()=>{
      const s=data().find(s=>s.name===r.skill&&s.repository===r.repository);need(s,'SKILL_BINDING');
      return wrap(s.name+': the tasks and scoring guides','Read and copy the exact text tasks used to test '+s.name+'. See the scoring guides, report findings and limits beside each task.',skillMain(s));
    }]))
  };
}
function outputs() {
  const {shell}=require('./build-site-pages');
  const {render}=require('./build-head-tags');
  return Object.entries(targets(shell)).map(([rel,build])=>({rel,html:render(build(),rel)}));
}
function main(argv) {
  need(argv.every(x=>x==='--check'),'Unknown argument');const check=argv.includes('--check');
  const pages=outputs();
  for(const {rel,html} of pages){
    const file=path.join(ROOT,'docs',rel);
    if(check)need(fs.existsSync(file)&&fs.readFileSync(file,'utf8')===html,'STALE: '+rel);
    else{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,html);}
  }
  console.log('tasks: '+pages.length+' pages '+(check?'match their sources':'written from suites and report readers'));
}
module.exports={bindSuite,translateLine,targets,outputs};
if(require.main===module){try{main(process.argv.slice(2));}catch(e){console.error('tasks: refused: '+e.message);process.exitCode=1;}}
