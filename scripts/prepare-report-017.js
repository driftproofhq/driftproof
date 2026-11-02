#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';
// Issue 627 (spec 627): Report 017, "Skill or sugar pill?", built from the campaign root only. Every
// reading and count comes through spec 613's reader (publication.cjs, tally.cjs), lib/plain.js and
// lib/verdict.js; the headline is outcomes.md's frozen template. Publish mode never reads a stub
// receipt; test mode (--stub) reads them and never writes under the tree's docs/.
//   node scripts/prepare-report-017.js [--root DIR] [--out DOCS] [--panel DIR] [--stub] [--check]
const fs=require('node:fs'),path=require('node:path');
const C=require('../specs/408-skill-measurements/campaign.cjs');
const P408=require('../specs/408-skill-measurements/publication.cjs');
const {reconstruct}=require('../specs/408-skill-measurements/reconstruct.cjs');
const R=require('../specs/613-placebo-skills-report/run-campaign.cjs');
const {publication}=require('../specs/613-placebo-skills-report/publication.cjs');
const {validateReceipt,verifyReceiptHash}=require('../lib/receipt');
const {plainOf}=require('../lib/plain');
const {placeboReading,placeboLine,armOf,receiptVerdict}=require('../lib/verdict');
const placebo=require('../lib/placebo');
const {sha256,sha256Files}=require('../lib/canonical');
const policy=require('../lib/report-015-publication');
const skillHandoff=require('./skill-handoff');
const {applyHeadTags}=require('./build-head-tags'),{reportRow}=require('./site-data.mjs');
const {annotateCampaignFigures}=require('./prepare-report-015');
const {humanModelName}=require('./model-names');
const ROOT=C.ROOT,REL='reports/017/index.html',CAMPAIGN='receipts/report-017c',PANEL='receipts/report-017-panel';
const TITLE='Skill or sugar pill? Twenty skills against a same-length placebo';
const TESTED="Report 015's twenty skills on Sonnet 5.5, each against no skill and against a same-length text from a fixed corpus, judged by Haiku 5.5.";
// What moved under the skill, for the TL;DR and the data layer (scripts/site-data.mjs reads data-what-moved).
const MOVED='a same-length placebo text';
// The opening's caveat (spec 627 A-627-3): it carries no count, so no headline line moves with it.
const CAVEAT='Where the fake scored below no skill, beating it does not mean beating no skill; each row shows both readings.';
const AMENDMENT_1='Added a note after the headline and in the rows for grill-me and grill-with-docs. The whole text of each skill only calls another skill, and these text tasks forbid tools. Counts, readings and receipts are unchanged.';
// The blind read's record (issue 638, spec 627 A-627-8), naming the skill its page uses.
const AMENDMENT_2=(skill)=>'Added a link, after the opening panel, to a blind read of '+skill+'\'s kept answers. Counts, readings and receipts are unchanged.';
// The dek: the model it was read on, then the frozen template line, its first letter lowercased
// when it opens with a word ("All", "None").
const lead=(h)=>/^[A-Z][a-z]/.test(h)?h[0].toLowerCase()+h.slice(1):h;
const dekOf=(c)=>'On '+humanModelName(c.ctx.plan.model)+', '+lead(c.pub.headline[0]);
// What it does not show: the snapshot, the model and judge, and the tasks.
const SNAPSHOT=/\d{4}-\d{2}-\d{2}/.exec(P408.TITLE)[0];
const scopeOf=(c)=>"It does not show how these skills do beyond three text tasks each, written by Driftproof for Report 015's twenty skills from the Skills.sh snapshot of "+SNAPSHOT+', on '+humanModelName(c.ctx.plan.model)+' judged by '+humanModelName(c.ctx.plan.judge)+'.';
// The reader that produced the page, pinned on it (spec 613 AC-22).
const READER=['scripts/prepare-report-017.js','specs/613-placebo-skills-report/publication.cjs','specs/613-placebo-skills-report/tally.cjs','specs/613-placebo-skills-report/run-campaign.cjs','specs/408-skill-measurements/ledger.cjs','specs/408-skill-measurements/reconstruct.cjs','lib/verdict.js','lib/plain.js','lib/placebo.js','lib/receipt.js','scripts/skill-handoff.js'];
const esc=C.esc,need=C.need;
const fmtDate=d=>new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(d));
// A repository path for a source, or the directory's own name for one outside the tree (tests).
const srcOf=dir=>{const rel=path.relative(ROOT,dir);return rel&&!rel.startsWith('..')&&!path.isAbsolute(rel)?rel.split(path.sep).join('/'):path.basename(dir);};

let published=null;
function report015(){if(!published)published=new Map(P408.readPublished(ROOT).items.map(x=>[x.attempt.attempt_id,x]));return published;}

// The campaign, read through the reader, then each receipt checked again and reconstructed.
// recordedHeads and reader reach spec 613's reader only when given (fixture roots, spec 613 A-613-3);
// the real root is read at its recorded head through git, as publication.cjs defaults.
function readCampaign({root=ROOT,campaignRoot,stub=false,report015Ids=null,recordedHeads,reader,panelDir,handoff=[]}){
 const dir=path.resolve(campaignRoot);
 need(fs.existsSync(path.join(dir,'campaign.log')),'CAMPAIGN_ROOT');
 // Every receipt each logged manifest names is present (spec 627 AC-2); a stub chain never
 // publishes (AC-8). Both before the reader runs, so its refusal names the cause.
 for(const e of R.readLog(dir)){
  const file=path.join(dir,e.manifest);need(fs.existsSync(file),'ATTEMPT_COVERAGE');const m=C.read(file);
  if(!stub)need(m.stub===false,'UNVERIFIED');
  for(const o of m.outcomes||[])if(o.status==='receipt')for(const s of ['.json','-answers.json'])need(fs.existsSync(path.join(path.dirname(file),o.attempt_id+s)),'ATTEMPT_COVERAGE');
 }
 const pub=publication({root,campaignRoot:dir,stub,...(recordedHeads?{recordedHeads}:{}),...(reader?{reader}:{})});
 const ctx=R.readPlan(root,{frozen:dir}),head=R.rootEntries(ctx,dir).at(-1).file,ledger=R.readChain(ctx,[head],stub,'publication');
 const last=ledger.manifests.at(-1).manifest,src=srcOf(dir);
 const ids=report015Ids||ctx.plan.rows.map(r=>r.report_015_attempt_id),r015=report015();
 const rows=ctx.plan.execution.attempts.map((a,i)=>{
  const p=pub.rows[i],row={index:i,attempt:a,attempt_id:a.attempt_id,skill:a.protocol.skill,repository:a.protocol.repository,router:p.router,reading:p,receipt:null,src:null,reason:null};
  need(p.attempt_id===a.attempt_id,'ATTEMPT_COVERAGE');
  const earlier=r015.get(ids[i]);
  need(earlier&&earlier.attempt.protocol.repository===a.protocol.repository&&earlier.attempt.protocol.skill===a.protocol.skill&&earlier.receipt.run.model_id===a.protocol.model,'REPORT_015_BINDING');
  row.report015={id:ids[i],hash:earlier.receipt.receipt_hash,date:earlier.receipt.run.date_utc.slice(0,10),label:policy.routerLimit(earlier.receipt)?.label||plainOf(earlier.receipt).label};
  const owner=ledger.receipts.get(a.attempt_id);
  if(!owner){row.reason=last.outcomes[i].reason;need(p.placebo==='NOT_MEASURED'&&p.receipt_hash===null,'ATTEMPT_COVERAGE');return row;}
  const at=path.dirname(owner.file),receipt=C.read(path.join(at,a.attempt_id+'.json')),answers=C.read(path.join(at,a.attempt_id+'-answers.json'));
  need(verifyReceiptHash(receipt)&&receipt.receipt_hash===p.receipt_hash,'RECEIPT_SEAL');
  need(validateReceipt(receipt).valid,'RECEIPT_SCHEMA');
  if(!stub){need(receipt.verification_level!=='UNVERIFIED','UNVERIFIED');need(receipt.run.surface==='claude-cli'&&receipt.run.judge.surface==='claude-cli','SURFACE_BINDING');}
  reconstruct(receipt,answers);
  // The line the reader gave is the line this receipt gives.
  need(placeboLine(placeboReading(receipt))===p.placebo_line,'READING_BINDING');
  // The plan's routers are exactly the receipts lib/report-015-publication.js limits, every surface alike.
  need(!!policy.routerLimit(receipt)===p.router,'ROUTER_RECEIPT_BINDING');
  return Object.assign(row,{receipt,src:src+'/'+path.relative(dir,at).split(path.sep).join('/')+'/'+a.attempt_id+'.json'});
 });
 need(rows.some(r=>r.receipt),'NO_RECEIPTS');
 // The skills whose whole text only calls another skill (spec 627 A-627-7): counted rows whose
 // committed texts are the plan's pinned bytes and pass the rule. The note moves no count.
 for(const id of handoff){const row=rows.find(r=>r.attempt_id===id);need(row&&!row.router,'HANDOFF_BINDING');}
 const handoffs=handoff.length?skillHandoff.handoffTexts({plan:ctx.plan,panelDir:panelDir||path.join(ROOT,PANEL),ids:handoff}):[];
 const handoffNote=handoffs.length?skillHandoff.note(handoffs,'the pre-registered counts'):null;
 for(const t of handoffs)rows.find(r=>r.attempt_id===t.attempt_id).handoffNote=handoffNote;
 return {dir,src,ctx,pub,ledger,rows,stub,handoffNote,note:fs.readFileSync(path.join(dir,'outcomes.md'),'utf8'),manifests:ledger.manifests.map(m=>({file:src+'/'+path.relative(dir,m.file).split(path.sep).join('/'),sha256:m.sha256}))};
}

// The opening panel (spec 627 AC-10): the shortest non-router skill with a receipt, chosen by its
// length alone, its pinned text checked against the receipt and its fake rebuilt from the block.
function panelOf(rows,panelDir){
 const pick=rows.filter(r=>!r.router&&r.receipt).sort((a,b)=>a.receipt.placebo.skill_bytes-b.receipt.placebo.skill_bytes||a.index-b.index)[0];
 const file=path.join(panelDir,pick.attempt_id+'.md');need(fs.existsSync(file),'PANEL_INPUT');
 const bytes=fs.readFileSync(file),b=pick.receipt.placebo;
 need(sha256(bytes)===pick.attempt.protocol.skill_sha256&&sha256Files([{path:'SKILL.md',bytes}])===pick.receipt.skill.content_hash&&b.seed===pick.receipt.skill.content_hash&&bytes.length===b.skill_bytes,'PANEL_BINDING');
 const fake=placebo.buildPlaceboText(b.bytes,b.seed,b.corpus,b.revision);
 need(placebo.sha256Hex(fake)===b.sha256&&Buffer.byteLength(fake,'utf8')===b.bytes&&placebo.corpusHashOf(b.corpus)===b.corpus_hash&&b.corpus_hash===placebo.PLACEBO_CORPUS_HASHES[b.revision],'PANEL_BINDING');
 return {row:pick,text:bytes.toString('utf8'),fake};
}

// The frozen note's own words for a section: its paragraphs and lists, code spans kept.
function noteSection(note,heading){
 const at=note.indexOf('\n## '+heading+'\n');need(at>=0,'OUTCOMES_BINDING');
 const body=note.slice(at+heading.length+5).split(/\n## /)[0].trim();
 const inline=s=>esc(s).replace(/`([^`]+)`/g,'<code>$1</code>');
 return body.split(/\n\n+/).filter(b=>!b.startsWith('```')).map(b=>/^- /.test(b)?'<ul>'+b.split(/\n(?=- )/).map(l=>'<li>'+inline(l.slice(2).replace(/\n\s*/g,' '))+'</li>').join('')+'</ul>':/^\d+\. /.test(b)?'<ol>'+b.split(/\n(?=\d+\. )/).map(l=>'<li>'+inline(l.replace(/^\d+\. /,'').replace(/\n\s*/g,' '))+'</li>').join('')+'</ol>':'<p>'+inline(b.replace(/\n/g,' '))+'</p>').join('');
}

// A recorded figure, in a data element naming the file it was read from (spec 627 AC-11).
const fig=(v,src)=>'<data value="'+esc(v)+'" data-src="'+esc(src)+'" data-at="recorded evidence" data-fn="receipt readers" data-dp="exact">'+esc(v)+'</data>';
const band=(a,src)=>a?fig(a.mean,src)+' plus or minus '+fig(a.sd,src):'no band';
// The tasks the placebo reading read, each with the skill's band and the placebo's, from the rows.
function tasksOf(receipt){
 if(!receipt)return [];
 const arm=(id,mode)=>armOf(receipt.results.cases.find(c=>c.id===id&&c.mode===mode));
 return placeboReading(receipt).cases.map(c=>({id:c.id,state:c.state,skill:arm(c.id,'with_skill'),fake:arm(c.id,'placebo')}));
}
// One skill's row (spec 627 AC-3, AC-5, AC-6, AC-7, AC-9). It types no reading: every line is the
// reader's or the library's, for this row's own receipt.
function rowHTML(row){
 const r=row.reading,p=row.receipt?plainOf(row.receipt):null,list=tasksOf(row.receipt);
 const router=row.router?'<p class="router-qualification">'+esc(policy.REASON)+' <a href="'+policy.AMENDMENT+'">Report 015 Amendment 1</a>. Left out of the headline count.</p>':'';
 const line=row.receipt?r.placebo_line:'not measured against the placebo: no sealed receipt for this attempt ('+row.reason+')';
 const src=row.src||'specs/613-placebo-skills-report/plan.json',reading=(v,at,text)=>'<data value="'+esc(v)+'" data-src="'+esc(src)+'" data-at="'+at+'">'+esc(text)+'</data>';
 const tasks=list.length?'<ul class="placebo-tasks">'+list.map(t=>'<li data-task="'+esc(t.id)+'">'+esc(t.id)+' ('+esc(t.state)+'): with the skill '+band(t.skill,src)+'; with the same-length placebo '+band(t.fake,src)+'.</li>').join('')+'</ul>':'';
 // A router's row reads Report 015 Amendment 1's label, never a skill verdict (spec 627 A-627-3).
 // Any other row gives plainOf's sentence, then its own why and each task's state against no skill.
 const against=row.receipt?receiptVerdict(row.receipt).cases.map(c=>({id:c.id,state:c.state,skill:armOf(row.receipt.results.cases.find(x=>x.id===c.id&&x.mode==='with_skill')),none:armOf(row.receipt.results.cases.find(x=>x.id===c.id&&x.mode==='baseline'))})):[];
 const verdict=!p?'':row.router?'<p class="verdict-sentence"><span class="row-label">Against no skill: </span>'+esc(policy.LABEL)+'.</p>':'<p class="verdict-sentence"><span class="row-label">Against no skill: </span>'+reading(r.verdict,'verdict',p.sentence)+'</p>'+(p.why&&p.why!==p.sentence?'<p class="verdict-why">'+reading(r.verdict,'verdict why',p.why)+'</p>':'')+(against.length?'<ul class="verdict-tasks">'+against.map(t=>'<li data-task="'+esc(t.id)+'">'+esc(t.id)+' ('+esc(t.state)+'): with the skill '+band(t.skill,src)+'; without it '+band(t.none,src)+'.</li>').join('')+'</ul>':'');
 const secondary='<p class="secondary-reading"><span class="row-label">The placebo against no skill, shown here and not counted: </span>'+reading(r.placebo_vs_baseline,'secondary reading',r.placebo_vs_baseline)+'</p>';
 const context='<p class="report-015-context"><span class="row-label">Context only, not this measurement: </span>Report 015 read this skill in a separate, earlier run on '+fig(row.report015.date,P408.DIR+'/'+row.report015.id+'.json')+': '+esc(row.report015.label)+'. <a href="/r/'+row.report015.hash+'/">Report 015 receipt</a></p>';
 const seal=row.receipt?'<p class="receipt-ref">Receipt <code>'+row.receipt.receipt_hash+'</code></p>':'';
 return '<section class="placebo-result'+(row.router?' router-result':'')+'" data-attempt="'+row.attempt_id+'" data-reading="'+esc(r.placebo)+'"><h3>'+esc(row.skill)+' <span class="comparison-repository">'+esc(row.repository)+'</span></h3>'+router+(row.handoffNote?'<p class="handoff-note">'+esc(row.handoffNote)+'</p>':'')+'<p class="placebo-line"><span class="row-label">Against the same-length placebo: </span>'+reading(r.placebo,'placebo reading',line)+'</p>'+tasks+verdict+secondary+context+seal+'</section>';
}

// A text that ends in whitespace says so in words, since a reader cannot see it and an editor may
// strip it (spec 627 A-627-5): the panel's placebo is the receipt's bytes, its last space included.
const NUMBER_WORDS=['zero','one','two','three','four','five','six','seven','eight','nine','ten'];
function trailingNote(text){
 const tail=/\s+$/.exec(text);if(!tail)return '';
 const n=tail[0].length,what=/^ +$/.test(tail[0])?(NUMBER_WORDS[n]||String(n))+(n===1?' space':' spaces'):JSON.stringify(tail[0])+' (as JSON)';
 return '<p class="panel-note">This text ends with '+esc(what)+'.</p>';
}
// The card's description (spec 627 A-627-5): the frozen headline's first claim, whole, after the
// model it was read on. It ends where the template's first clause ends, never inside one; the
// fake is named by what it is. No count is typed here: each number is the template's own.
function descriptionOf(c){
 const h=lead(c.pub.headline[0]),clause=/^[\s\S]*?(?=:|\.(?:\s|$))/.exec(h)[0].trim();
 const named=clause.replace(/\bthe fake\b/g,'a same-length placebo');
 const out='On '+humanModelName(c.ctx.plan.model)+', '+named+(/case rule/.test(h)&&!/by the case rule$/.test(named)?' by the case rule':'')+'.';
 need(out.length>=50&&out.length<=155&&!out.includes('…'),'DESCRIPTION');
 return out;
}
function body(c,{panelDir,placeboPage}){
 const H=c.pub.headline,receipts=c.rows.filter(r=>r.receipt),all=receipts.map(r=>r.src).join(' ');
 const dates=receipts.map(r=>r.receipt.run.date_utc).sort(),first=dates[0],lastDate=dates.at(-1);
 const model=c.ctx.plan.model,judge=c.ctx.plan.judge,panel=panelOf(c.rows,panelDir),b=panel.row.receipt.placebo;
 const head='<h1 data-what-moved="'+esc(MOVED)+'">'+esc(TITLE)+'</h1><p class="report-meta">Report 017. Recorded on <data data-row="date" value="'+first.slice(0,10)+'" data-src="'+esc(receipts.find(r=>r.receipt.run.date_utc===first).src)+'">'+fmtDate(first)+'</data>. Answering model <data data-row="model" value="'+model+'" data-src="config/models.json">'+esc(humanModelName(model))+'</data>; judge '+esc(humanModelName(judge))+'.</p><p class="report-type">Placebo comparison report<span class="muted">. '+esc(TESTED)+'</span></p>';
 const headline='<div class="headline"><p class="big" data-card-description="'+esc(descriptionOf(c))+'">On '+esc(humanModelName(model))+', '+annotateCampaignFigures(esc(lead(H[0])),all)+'</p></div><p class="headline-counts" data-fn="placebo-tally">'+annotateCampaignFigures(esc(H[1]),all)+'</p><p class="headline-routers">'+esc(H[2])+'</p><p class="headline-caveat">'+esc(CAVEAT)+'</p>'+(c.handoffNote?'<p class="handoff-note">'+esc(c.handoffNote)+'</p>':'');
 const panelHTML='<figure class="placebo-panel"><div class="panel-arms"><div class="panel-arm"><p class="panel-name">The skill: '+esc(panel.row.skill)+'</p><pre class="panel-skill">'+esc(panel.text)+'</pre></div><div class="panel-arm"><p class="panel-name">Its same-length placebo</p><pre class="panel-placebo">'+esc(panel.fake)+'</pre>'+trailingNote(panel.fake)+'</div></div><figcaption>'+annotateCampaignFigures(esc(panel.row.skill)+', the shortest skill counted in the headline ('+b.skill_bytes+' bytes), beside its placebo: the same length to the byte, rebuilt from the receipt\'s seed, length and corpus, with the SHA-256 the receipt seals.',panel.row.src)+(placeboPage?' <a href="/placebo/">Fake my file</a>.':'')+'</figcaption></figure>';
 const method='<h2>Method</h2><p>These sections are the pre-registered note, as the campaign first stored it.</p><h3>What each receipt shows</h3>'+noteSection(c.note,'What each receipt shows')+'<h3>Which receipt is read</h3>'+noteSection(c.note,'Which receipt is read')+'<h3>Terms</h3>'+noteSection(c.note,'Terms')+'<h3>Who is counted</h3>'+noteSection(c.note,'Who is counted')+'<h3>The secondary reading</h3>'+noteSection(c.note,'Secondary reading: the placebo against no skill');
 const results='<h2 id="each-skill">Each skill</h2><p>In Report 015\'s order. Each row is one receipt, read by the receipt reader.</p><div class="placebo-results">'+c.rows.map(rowHTML).join('')+'</div>';
 const limits='<h2>Limits</h2><p class="report-scope">'+esc(scopeOf(c)).replace(SNAPSHOT,fig(SNAPSHOT,'specs/408-skill-measurements/popularity.json'))+'</p><p>'+esc(P408.SCOPE)+'</p><p>'+esc(P408.ISOLATION)+'</p><p class="router-subjects">For find-skills, agent-browser, hyperframes and hyperframes-registry: '+esc(P408.ROUTER)+'</p>'+noteSection(c.note,'Limits')+noteSection(c.note,'What the report does not say')+'<p>The placebo corpus was chosen without reference to any task, so a placebo text can still bear on a task by chance.</p><p>Unkeyed seals and retained outputs permit checking internal consistency; they do not authenticate an origin.</p>';
 const surfaces=[...new Set(receipts.map(r=>r.receipt.run.surface))].sort().join(', ');
 const record='<section id="campaign-run-record"><h2>Run record</h2>'+annotateCampaignFigures('<p>One campaign root, <code>'+esc(c.src)+'</code>, read from the latest manifest its log names. '+receipts.length+' of '+c.rows.length+' attempts have a sealed receipt; every other attempt is a recorded failure and reads NOT_MEASURED. The earliest receipt date is '+fig(first.slice(0,10),receipts.find(r=>r.receipt.run.date_utc===first).src)+' and the latest '+fig(lastDate.slice(0,10),receipts.find(r=>r.receipt.run.date_utc===lastDate).src)+'. No finish time is inferred.</p><p>The surface was '+esc(surfaces)+'. Recorded spend across the chain: USD '+c.ledger.spent+'. Recorded costs are API-equivalent estimates, not a subscription invoice.</p>',c.manifests.at(-1).file)+'<ol class="campaign-runs">'+c.manifests.map(m=>'<li><code>'+esc(m.file)+'</code>, SHA-256 <code>'+m.sha256+'</code></li>').join('')+'</ol><p>Plan SHA-256 <code>'+c.ctx.plan_hash+'</code>. Pre-registered note SHA-256 <code>'+c.ctx.plan.outcomes.sha256+'</code>.</p><p>Read and built by:</p><ul class="reader-pins">'+READER.map(f=>'<li><code>'+f+'</code>, SHA-256 <code>'+sha256(fs.readFileSync(path.join(ROOT,f)))+'</code></li>').join('')+'</ul></section>';
 const list='<h2>Receipts</h2><ul>'+receipts.map(r=>'<li><a href="https://github.com/driftproofhq/driftproof/blob/main/'+esc(r.src)+'">'+esc(r.skill)+' on '+esc(humanModelName(r.receipt.run.model_id))+'</a></li>').join('')+'</ul>';
 // Issue 638 (spec 627 A-627-8): one line to the blind read, after the panel, naming the skill that
 // page's rule picks (the shortest counted skill that is not a hand-off). Required here, at call time:
 // that builder requires this one.
 const blindSkill=esc(require('./build-report-017-blind.js').skillOf(c.rows,panelDir).row.skill);
 const blindLink='<p class="blind-link"><a href="/reports/017/blind/">Can you tell which answer had the skill? Try a blind read of '+blindSkill+'&#39;s kept answers</a>.</p>';
 // The dated records, before the receipts so a later entry appends: the hand-off note's (spec 627
 // A-627-7), which appears only with the note, then the blind read's (A-627-8), always. The entries
 // keep the published page's numbers whichever are present, so a record never renumbers.
 const amendments='<h2 id="amendments">Amendments</h2>'+(c.handoffNote?'<section id="amendment-1"><h3>Amendment 1, 2 Nov 2026</h3><p>'+esc(AMENDMENT_1)+'</p></section>':'')
  +'<section id="amendment-2"><h3>Amendment 2, 2 Nov 2026</h3><p>'+esc(AMENDMENT_2(blindSkill))+'</p></section>';
 return head+headline+panelHTML+blindLink+results+method+limits+record+amendments+list;
}

function summaryRow(c){return {points:[['What we tested.',TESTED],['What we found.',dekOf(c)],['Beating the fake is not beating no skill.',CAVEAT],['What it does not show.',scopeOf(c)]].map(([lead,text])=>({lead,text,sources:[{file:'docs/'+REL,quote:text}]}))};}

function buildReport(opts={}){
 const c=readCampaign(opts),placeboPage=opts.placeboPage??fs.existsSync(path.join(ROOT,'docs/placebo/index.html'));
 const raw='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>'+esc(TITLE)+' | Driftproof</title><link rel="stylesheet" href="/style.css"></head><body><main class="report shaped">'+body(c,{panelDir:opts.panelDir||path.join(ROOT,PANEL),placeboPage})+'</main></body></html>\n';
 const row=reportRow('017',{pageRel:'docs/'+REL,html:raw});
 // A second application normalizes the inserted shared chrome's boundary whitespace, as for Report 015.
 return {html:applyHeadTags(applyHeadTags(raw,REL,undefined,undefined,[row]),REL,undefined,undefined,[row]),summary:summaryRow(c),campaign:c};
}

// What a build writes: the page and the 017 row of the summaries, nothing else (spec 627 AC-15).
function outputs(opts){
 const out=path.resolve(opts.out||path.join(ROOT,'docs'));
 if(opts.stub)need(!(out+path.sep).startsWith(path.join(ROOT,'docs')+path.sep),'OUTPUT_DIRECTORY');
 const built=buildReport(opts),summaryFile=path.join(out,'data/report-summaries.json');
 const summary=JSON.parse(fs.readFileSync(fs.existsSync(summaryFile)?summaryFile:path.join(ROOT,'docs/data/report-summaries.json'),'utf8'));
 summary.reports['017']=built.summary;
 return {page:path.join(out,REL),html:built.html,summaryFile,summary:JSON.stringify(summary,null,2)+'\n',built};
}
// The summary row first: the shared chrome reads it into the page's answer section, so the page is
// built once the row it renders is in place, and a second write changes nothing.
function writeReport(opts){
 const first=outputs(opts);fs.mkdirSync(path.dirname(first.summaryFile),{recursive:true});fs.writeFileSync(first.summaryFile,first.summary);
 const o=outputs(opts);need(o.summary===first.summary,'REPORT_SUMMARY_DRIFT');fs.mkdirSync(path.dirname(o.page),{recursive:true});fs.writeFileSync(o.page,o.html);return o;
}
function checkReport(opts){const o=outputs(opts);need(fs.existsSync(o.page)&&fs.readFileSync(o.page,'utf8')===o.html,'REPORT_DRIFT');need(fs.existsSync(o.summaryFile)&&fs.readFileSync(o.summaryFile,'utf8')===o.summary,'REPORT_SUMMARY_DRIFT');return o;}

function parse(argv){
 const o={campaignRoot:path.join(ROOT,CAMPAIGN),handoff:[...skillHandoff.ATTEMPTS]};
 for(let i=0;i<argv.length;i++){const a=argv[i];if(a==='--check')o.check=true;else if(a==='--stub')o.stub=true;else if(['--root','--out','--panel'].includes(a)){const v=argv[++i];need(v&&!v.startsWith('--'),'ARGUMENT');o[{'--root':'campaignRoot','--out':'out','--panel':'panelDir'}[a]]=v;}else C.fail('ARGUMENT');}
 return o;
}
function main(argv=process.argv.slice(2)){
 const o=parse(argv),done=o.check?checkReport(o):writeReport(o),n=done.built.campaign.rows.filter(r=>r.receipt).length;
 console.log('report 017: page and summary '+(o.check?'match':'written from')+' '+n+'/20 sealed '+(o.stub?'stub receipts (test mode, not for publication)':'receipts')+'; headline shape '+done.built.campaign.pub.tally.shape);
}
module.exports={TITLE,REL,CAMPAIGN,PANEL,READER,readCampaign,panelOf,tasksOf,rowHTML,buildReport,summaryRow,outputs,writeReport,checkReport,parse,main};
if(require.main===module)try{main();}catch(e){console.error('report 017: refused: '+(e.code||e.message));process.exitCode=1;}
