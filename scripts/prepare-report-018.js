#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';
// Issue 669 (spec 669): Report 018, "Skill or sugar pill, on Haiku?", built from the campaign root only.
// Every reading and count comes through spec 655's reader (run-campaign.cjs publication, spec 613's
// tally.cjs), lib/plain.js and lib/verdict.js; the headline is the frozen note's template. The
// same-model limitation is the plan's pinned string, shown before any reading and with every reading.
// No Report 017 or Report 015 reading appears. Publish mode never reads a stub receipt; test mode
// (--stub) reads them and never writes under the tree's docs/.
//   node scripts/prepare-report-018.js [--root DIR] [--out DOCS] [--panel DIR] [--stub] [--check]
// The row, panel, note and record renderers are this file's own copies of Report 017's (spec 669
// Inferences 2): Report 017's page pins its builder's bytes, so nothing is imported from it.
const fs=require('node:fs'),path=require('node:path');
const C=require('../specs/408-skill-measurements/campaign.cjs');
const P408=require('../specs/408-skill-measurements/publication.cjs');
const {reconstruct}=require('../specs/408-skill-measurements/reconstruct.cjs');
const R=require('../specs/655-report-018-plan/run-campaign.cjs');
const P=require('../specs/655-report-018-plan/protocol.cjs');
const {validateReceipt,verifyReceiptHash,repositoryJudgeRelationship}=require('../lib/receipt');
const {plainOf}=require('../lib/plain');
const {placeboReading,placeboLine,armOf,receiptVerdict}=require('../lib/verdict');
const placebo=require('../lib/placebo');
const {sha256,sha256Files}=require('../lib/canonical');
const policy=require('../lib/report-015-publication');
const skillHandoff=require('./skill-handoff');
const sendResult=require('./build-send-result');
const {applyHeadTags}=require('./build-head-tags'),{reportRow}=require('./site-data.mjs');
const {annotateCampaignFigures}=require('./prepare-report-015');
const {humanModelName}=require('./model-names');
const ROOT=C.ROOT,REL='reports/018/index.html',CAMPAIGN='receipts/report-018';
// The panel inputs are Report 017's pinned texts, named by their Report 017 attempt id; each plan row
// names its Report 017 attempt and carries the same skill_sha256 pin (spec 669 Inferences 3).
const PANEL='receipts/report-017-panel';
const TITLE='Skill or sugar pill, on Haiku? Twenty skills against a same-length placebo';
const TESTED='Twenty skills on Haiku 5.5, each against no skill and against a same-length text from a fixed corpus, judged by Haiku 5.5, the same model.';
// What moved under the skill, for the TL;DR and the data layer (scripts/site-data.mjs reads data-what-moved).
const MOVED='a same-length placebo text';
// The opening's caveat: it carries no count, so no headline line moves with it.
const CAVEAT='Where the fake scored below no skill, beating it does not mean beating no skill; each row shows both readings.';
// The limitation the plan pins, in lib/receipt.js's words for this protocol's target and judge.
const LIMITATION=repositoryJudgeRelationship(P.MODEL,P.JUDGE).limitation;
// The page's dated record (spec 669 A-669-4; CONSTITUTION item 6, spec 020 AC-21): a published body
// moves only with its Amendments. Issue 671: lib/plain.js rewords the verdict line where the averages
// do not point the verdict's way, and the rows print that line.
const AMENDMENT_1='Reworded the line against no skill in the rows where the overall averages with and without the skill do not point the verdict\'s way: it names the task that decided it and gives the averages over all the tasks. The verdict is decided per task, so those averages can sit equal or point the other way. Counts, readings and receipts are unchanged.';
// Issue 690's record (spec 669 A-669-5, spec 690): each row with a receipt carries the judge-notes
// mount, so the published body moves.
const AMENDMENT_2='Added, under each task of every row with a receipt, a way to open that task\'s prompt and rubric, the kept answers with the skill, with the fake text and with nothing, and the judge\'s scores and reasons for one try at a time. Counts, readings and receipts are unchanged.';
// The judge-notes mount (spec 690 AC-9, AC-11): the island docs/islands/judge-notes.js mounts on it
// and reads the row's own data file, built by scripts/build-judge-notes.js. The static fallback is one
// paragraph with no numeral and no link: a receipt link here would be counted as one of the report's
// receipts (scripts/site-data.mjs reads every receipt href), and the row's receipt is already listed.
const notesMount=(row)=>'<div class="judge-notes" data-island="judge-notes" data-notes-src="/reports/018/notes/'+row.attempt_id+'.json"><p>See the question and the judge&#39;s notes: with JavaScript on, each task name above opens its prompt and rubric, the kept answers and the judge&#39;s scores and reasons, one try at a time. Without it, the kept answers sit beside this row&#39;s receipt in the repository, under Receipts at the end of the report.</p></div>';
// Plain words for each placebo reading (A-669-3), shown first in the chart, the plain counts line and
// each row's summary line, the reader's token beside them. The reader's own line stays verbatim in the
// row. "Beat the fake" is ABOVE_PLACEBO and nothing else (the note, "Terms").
const PLAIN={ABOVE_PLACEBO:'beat the fake',BELOW_PLACEBO:'below the fake',NO_DIFFERENCE:'no difference',INCONCLUSIVE:'inconclusive',UNDERPOWERED:'too few answers to tell',NOT_MEASURED:'not measured'};
// The tally's counts, in the frozen counts line's order (spec 613 tally.cjs keys).
const COUNTS=[['A','ABOVE_PLACEBO'],['B','BELOW_PLACEBO'],['D','NO_DIFFERENCE'],['I','INCONCLUSIVE'],['U','UNDERPOWERED'],['M','NOT_MEASURED']];
// What it does not show: the snapshot, the model and judge, and the tasks.
const SNAPSHOT=/\d{4}-\d{2}-\d{2}/.exec(P408.TITLE)[0];
const scopeOf=(c)=>'It does not show how these skills do beyond three text tasks each, written by Driftproof for the twenty skills from the Skills.sh snapshot of '+SNAPSHOT+', on '+humanModelName(c.ctx.plan.model)+' judged by '+humanModelName(c.ctx.plan.judge)+'.';
// The reader that produced the page, pinned on it.
const READER=['scripts/prepare-report-018.js','specs/655-report-018-plan/run-campaign.cjs','specs/655-report-018-plan/protocol.cjs','specs/613-placebo-skills-report/run-campaign.cjs','specs/613-placebo-skills-report/tally.cjs','specs/408-skill-measurements/ledger.cjs','specs/408-skill-measurements/reconstruct.cjs','lib/verdict.js','lib/plain.js','lib/placebo.js','lib/receipt.js','scripts/skill-handoff.js'];
const esc=C.esc,need=C.need;
const fmtDate=d=>new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(d));
// A repository path for a source, or the directory's own name for one outside the tree (tests).
const srcOf=dir=>{const rel=path.relative(ROOT,dir);return rel&&!rel.startsWith('..')&&!path.isAbsolute(rel)?rel.split(path.sep).join('/'):path.basename(dir);};

// The campaign, read through the reader, then each receipt checked again and reconstructed.
// recordedHeads and reader reach the reader only when given (fixture roots); the real root is read
// at its recorded head through git, as the reader defaults.
function readCampaign({root=ROOT,campaignRoot,stub=false,recordedHeads,reader,panelDir}){
 const dir=path.resolve(campaignRoot);
 need(fs.existsSync(path.join(dir,'campaign.log')),'CAMPAIGN_ROOT');
 // Every receipt each logged manifest names is present (AC-2); a stub chain never publishes (AC-8).
 // Both before the reader runs, so its refusal names the cause.
 for(const e of R.readLog(dir)){
  const file=path.join(dir,e.manifest);need(fs.existsSync(file),'ATTEMPT_COVERAGE');const m=C.read(file);
  if(!stub)need(m.stub===false,'UNVERIFIED');
  for(const o of m.outcomes||[])if(o.status==='receipt')for(const s of ['.json','-answers.json'])need(fs.existsSync(path.join(path.dirname(file),o.attempt_id+s)),'ATTEMPT_COVERAGE');
 }
 const pub=R.publication({root,campaignRoot:dir,stub,...(recordedHeads?{recordedHeads}:{}),...(reader?{reader}:{})});
 const ctx=R.readPlan(root,{frozen:dir}),head=R.rootEntries(ctx,dir).at(-1).file,ledger=R.readChain(ctx,[head],stub,'publication');
 const last=ledger.manifests.at(-1).manifest,src=srcOf(dir);
 // The limitation is the reader's, which is the plan's, which is the library's (AC-9).
 const limitation=pub.judge_relationship;
 need(limitation===LIMITATION&&limitation===ctx.plan.judge_relationship,'LIMITATION_BINDING');
 const rows=ctx.plan.execution.attempts.map((a,i)=>{
  const p=pub.rows[i],planRow=ctx.plan.rows[i];
  const row={index:i,attempt:a,attempt_id:a.attempt_id,skill:a.protocol.skill,repository:a.protocol.repository,router:p.router,handoff:p.handoff,panel_id:planRow.report_017_attempt_id,limitation:p.judge_relationship,reading:p,receipt:null,src:null,reason:null};
  need(p.attempt_id===a.attempt_id&&planRow.attempt_id===a.attempt_id,'ATTEMPT_COVERAGE');
  need(p.judge_relationship===limitation,'LIMITATION_BINDING');
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
 // The hand-off skills (AC-13): the plan's attempts, each a counted row whose pinned text, read from the
 // panel inputs by its Report 017 attempt id, is this plan's pin and passes the rule; the note is the
 // rule's words for those texts, and the plan's, and the reader's.
 const h=ctx.plan.handoff,roster=C.read(path.join(root,P.ROSTER,'plan.json')),panel=panelDir||path.join(ROOT,PANEL);
 const texts=h.attempt_ids.map(id=>{
  const row=rows.find(r=>r.attempt_id===id);need(row&&!row.router,'HANDOFF_BINDING');
  const [t]=skillHandoff.handoffTexts({plan:roster,panelDir:panel,ids:[row.panel_id]});
  need(t.sha256===row.attempt.protocol.skill_sha256&&t.skill===row.skill&&t.repository===row.repository,'HANDOFF_BINDING');
  return t;
 });
 const handoffNote=skillHandoff.note(texts,P.HANDOFF_COUNTS);
 need(handoffNote===h.note&&handoffNote===pub.handoff_note,'HANDOFF_BINDING');
 need(rows.filter(r=>r.handoff).map(r=>r.attempt_id).join(',')===h.attempt_ids.join(','),'HANDOFF_BINDING');
 for(const id of h.attempt_ids)rows.find(r=>r.attempt_id===id).handoffNote=handoffNote;
 return {dir,src,ctx,pub,ledger,rows,stub,limitation,handoffNote,note:fs.readFileSync(path.join(dir,'outcomes.md'),'utf8'),manifests:ledger.manifests.map(m=>({file:src+'/'+path.relative(dir,m.file).split(path.sep).join('/'),sha256:m.sha256}))};
}

// The opening panel (AC-16): the shortest non-router skill with a receipt, chosen by its length alone,
// its pinned text read by its Report 017 attempt id, checked against this plan's pin and the receipt,
// and its fake rebuilt from the block.
function panelOf(rows,panelDir){
 const pick=rows.filter(r=>!r.router&&r.receipt).sort((a,b)=>a.receipt.placebo.skill_bytes-b.receipt.placebo.skill_bytes||a.index-b.index)[0];
 const file=path.join(panelDir,pick.panel_id+'.md');need(fs.existsSync(file),'PANEL_INPUT');
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

// A recorded figure, in a data element naming the file it was read from (AC-12).
const fig=(v,src)=>'<data value="'+esc(v)+'" data-src="'+esc(src)+'" data-at="recorded evidence" data-fn="receipt readers" data-dp="exact">'+esc(v)+'</data>';
const band=(a,src)=>a?fig(a.mean,src)+' plus or minus '+fig(a.sd,src):'no band';
// The tasks the placebo reading read, each with the skill's band and the placebo's, from the rows.
function tasksOf(receipt){
 if(!receipt)return [];
 const arm=(id,mode)=>armOf(receipt.results.cases.find(c=>c.id===id&&c.mode===mode));
 return placeboReading(receipt).cases.map(c=>({id:c.id,state:c.state,skill:arm(c.id,'with_skill'),fake:arm(c.id,'placebo')}));
}
// The chart (AC-19): the 16 counted skills by placebo reading, as bars of counts only, every count the
// tally's. Inline SVG in the page's own colour (currentColor), so it reads in both themes; its title
// and the figcaption are its text alternative. No ratio, score or ranking: a bar is a count of N.
function chartHTML(t,src){
 const rows=COUNTS.map(([k,tok])=>{need(Number.isInteger(t[k])&&t[k]>=0&&t[k]<=t.N,'TALLY_BINDING');return {tok,n:t[k],plain:PLAIN[tok]};});
 const W=360,L=176,BAR=140,H=22,top=4,h=top+rows.length*H+4;
 const title='The '+t.N+' skills the headline counts, by placebo reading: '+rows.map(r=>r.n+' '+r.plain).join(', ')+'. Counts only.';
 const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+W+' '+h+'" width="100%" role="img" aria-labelledby="placebo-chart-title" class="placebo-chart-svg" font-size="13" fill="currentColor"><title id="placebo-chart-title">'+esc(title)+'</title>'
  +rows.map((r,i)=>{const y=top+i*H,w=Math.round(BAR*r.n/t.N);return '<text x="0" y="'+(y+15)+'">'+esc(r.plain)+'</text><rect x="'+L+'" y="'+(y+4)+'" width="'+w+'" height="14" opacity="0.85"/><text x="'+(L+w+6)+'" y="'+(y+15)+'" class="chart-count" data-count-of="'+esc(r.tok)+'">'+r.n+'</text>';}).join('')+'</svg>';
 const legend='The '+t.N+' skills the headline counts, by their placebo reading, counts only. In the reader\'s words, '+rows.map(r=>r.plain+' is '+r.tok).join(', ')+'. The four routers are left out, as the headline leaves them out.';
 return '<figure class="placebo-chart">'+svg+'<figcaption>'+annotateCampaignFigures(esc(legend),src)+'</figcaption></figure>';
}
// The plain-words counts line (A-669-3), beside the frozen counts line and never in its place.
function plainCountsHTML(t,src){
 const text='Of the '+t.N+' skills counted: '+COUNTS.map(([k,tok])=>t[k]+' '+PLAIN[tok]).join(', ')+'.';
 return '<p class="headline-counts-plain">'+annotateCampaignFigures(esc(text),src)+'</p>';
}
// One skill's row (AC-3, AC-5, AC-6, AC-7, AC-9, AC-11, AC-13, AC-20). It types no reading: every line is
// the reader's or the library's, for this row's own receipt, and the limitation is the library's string.
// The row opens on one summary line (the skill, its placebo reading in plain words with the reader's
// token, its verdict line) and holds the full row in a details element that works without script; the
// limitation stands outside the details, beside the reading, so it is read with the row closed.
function rowHTML(row){
 need(row.limitation===LIMITATION,'LIMITATION_BINDING');
 const r=row.reading,p=row.receipt?plainOf(row.receipt):null,list=tasksOf(row.receipt);
 need(Object.hasOwn(PLAIN,r.placebo),'READING_UNKNOWN');
 const plainReading=esc(PLAIN[r.placebo])+' <code class="reading-token">'+esc(r.placebo)+'</code>'+(row.router?' (a router, left out of the headline count)':'');
 const verdictLine=!row.receipt?'not measured: no sealed receipt for this attempt ('+esc(row.reason)+')':row.router?esc(policy.LABEL)+'.':esc(p.sentence);
 const summary='<summary><span class="row-skill">'+esc(row.skill)+' <span class="comparison-repository">'+esc(row.repository)+'</span></span> <span class="row-reading"><span class="row-label">Against the same-length placebo: </span>'+plainReading+'</span> <span class="row-verdict"><span class="row-label">Against no skill: </span>'+verdictLine+'</span></summary>';
 const router=row.router?'<p class="router-qualification">'+esc(policy.REASON)+' <a href="'+policy.AMENDMENT+'">Report 015 Amendment 1</a>. Left out of the headline count.</p>':'';
 const line=row.receipt?r.placebo_line:'not measured against the placebo: no sealed receipt for this attempt ('+row.reason+')';
 const src=row.src||P.SPEC+'/plan.json',reading=(v,at,text)=>'<data value="'+esc(v)+'" data-src="'+esc(src)+'" data-at="'+at+'">'+esc(text)+'</data>';
 const tasks=list.length?'<ul class="placebo-tasks">'+list.map(t=>'<li data-task="'+esc(t.id)+'">'+esc(t.id)+' ('+esc(t.state)+'): with the skill '+band(t.skill,src)+'; with the same-length placebo '+band(t.fake,src)+'.</li>').join('')+'</ul>':'';
 // A router's row reads Report 015 Amendment 1's label, never a skill verdict. Any other row gives
 // plainOf's sentence, then its own why and each task's state against no skill.
 const against=row.receipt?receiptVerdict(row.receipt).cases.map(c=>({id:c.id,state:c.state,skill:armOf(row.receipt.results.cases.find(x=>x.id===c.id&&x.mode==='with_skill')),none:armOf(row.receipt.results.cases.find(x=>x.id===c.id&&x.mode==='baseline'))})):[];
 const verdict=!p?'':row.router?'<p class="verdict-sentence"><span class="row-label">Against no skill: </span>'+esc(policy.LABEL)+'.</p>':'<p class="verdict-sentence"><span class="row-label">Against no skill: </span>'+reading(r.verdict,'verdict',p.sentence)+'</p>'+(p.why&&p.why!==p.sentence?'<p class="verdict-why">'+reading(r.verdict,'verdict why',p.why)+'</p>':'')+(against.length?'<ul class="verdict-tasks">'+against.map(t=>'<li data-task="'+esc(t.id)+'">'+esc(t.id)+' ('+esc(t.state)+'): with the skill '+band(t.skill,src)+'; without it '+band(t.none,src)+'.</li>').join('')+'</ul>':'');
 const limitation='<p class="judge-limitation">'+esc(row.limitation)+'</p>';
 const secondary='<p class="secondary-reading"><span class="row-label">The placebo against no skill, shown here and not counted: </span>'+reading(r.placebo_vs_baseline,'secondary reading',r.placebo_vs_baseline)+'</p>';
 const seal=row.receipt?'<p class="receipt-ref">Receipt <code>'+row.receipt.receipt_hash+'</code></p>':'';
 const notes=row.receipt?notesMount(row):'';
 const html='<section class="placebo-result'+(row.router?' router-result':'')+'" data-attempt="'+row.attempt_id+'" data-reading="'+esc(r.placebo)+'">'+sendResult.render(sendResult.reportPayload('018',row))+'<details class="placebo-row">'+summary+'<h3>'+esc(row.skill)+' <span class="comparison-repository">'+esc(row.repository)+'</span></h3>'+router+(row.handoffNote?'<p class="handoff-note">'+esc(row.handoffNote)+'</p>':'')+'<p class="placebo-line"><span class="row-label">Against the same-length placebo: </span>'+reading(r.placebo,'placebo reading',line)+'</p>'+tasks+verdict+notes+secondary+seal+'</details>'+limitation+'</section>';
 // The limitation is outside the details, read with the row closed (AC-20).
 need(/<\/details><p class="judge-limitation">[^<]*<\/p><\/section>$/.test(html),'LIMITATION_VISIBLE');
 return html;
}

// A text that ends in whitespace says so in words, since a reader cannot see it and an editor may
// strip it: the panel's placebo is the receipt's bytes, its last space included.
const NUMBER_WORDS=['zero','one','two','three','four','five','six','seven','eight','nine','ten'];
function trailingNote(text){
 const tail=/\s+$/.exec(text);if(!tail)return '';
 const n=tail[0].length,what=/^ +$/.test(tail[0])?(NUMBER_WORDS[n]||String(n))+(n===1?' space':' spaces'):JSON.stringify(tail[0])+' (as JSON)';
 return '<p class="panel-note">This text ends with '+esc(what)+'.</p>';
}
// The card's description (AC-4, A-669-1): the frozen headline's first claim, whole and verbatim, so
// it opens the dek it is derived from (spec 020 AC-14 reads its first 40 characters against the
// headline block); where that clause says "the fake" without naming the placebo, the description
// says after it what the fake is. It ends where the template's first clause ends, never inside one.
// No count is typed here: each number is the template's own, and the template names the model itself.
function descriptionOf(c){
 const h=c.pub.headline[0],clause=/^[\s\S]*?(?=:|\.(?:\s|$))/.exec(h)[0].trim();
 let out=clause+(/case rule/.test(h)&&!/by the case rule$/.test(clause)?' by the case rule':'');
 if(/\bthe fake\b/.test(out)&&!/placebo/.test(out))out+=': the fake is a same-length placebo text';
 out+='.';
 need(out.length>=50&&out.length<=155&&!out.includes('…')&&h.startsWith(clause),'DESCRIPTION');
 return out;
}
function body(c,{panelDir,placeboPage}){
 const H=c.pub.headline,receipts=c.rows.filter(r=>r.receipt),all=receipts.map(r=>r.src).join(' ');
 const dates=receipts.map(r=>r.receipt.run.date_utc).sort(),first=dates[0],lastDate=dates.at(-1);
 const model=c.ctx.plan.model,judge=c.ctx.plan.judge,panel=panelOf(c.rows,panelDir),b=panel.row.receipt.placebo;
 const head='<h1 data-what-moved="'+esc(MOVED)+'">'+esc(TITLE)+'</h1><p class="report-meta">Report 018. Recorded on <data data-row="date" value="'+first.slice(0,10)+'" data-src="'+esc(receipts.find(r=>r.receipt.run.date_utc===first).src)+'">'+fmtDate(first)+'</data>. Answering model <data data-row="model" value="'+model+'" data-src="config/models.json">'+esc(humanModelName(model))+'</data>; judge '+esc(humanModelName(judge))+'.</p><p class="report-type">Placebo comparison report<span class="muted">. '+esc(TESTED)+'</span></p>';
 // The limitation before any reading (AC-9), then the headline (AC-4), the caveat and the hand-off note.
 const limitation='<p class="judge-limitation">'+esc(c.limitation)+'</p>';
 const headline='<div class="headline"><p class="big" data-card-description="'+esc(descriptionOf(c))+'">'+annotateCampaignFigures(esc(H[0]),all)+'</p></div><p class="headline-counts" data-fn="placebo-tally">'+annotateCampaignFigures(esc(H[1]),all)+'</p>'+plainCountsHTML(c.pub.tally,all)+'<p class="headline-routers">'+esc(H[2])+'</p><p class="headline-caveat">'+esc(CAVEAT)+'</p><p class="handoff-note">'+esc(c.handoffNote)+'</p>'+chartHTML(c.pub.tally,all);
 const panelHTML='<figure class="placebo-panel"><div class="panel-arms"><div class="panel-arm"><p class="panel-name">The skill: '+esc(panel.row.skill)+'</p><pre class="panel-skill">'+esc(panel.text)+'</pre></div><div class="panel-arm"><p class="panel-name">Its same-length placebo</p><pre class="panel-placebo">'+esc(panel.fake)+'</pre>'+trailingNote(panel.fake)+'</div></div><figcaption>'+annotateCampaignFigures(esc(panel.row.skill)+', the shortest skill counted in the headline ('+b.skill_bytes+' bytes), beside its placebo: the same length to the byte, rebuilt from the receipt\'s seed, length and corpus, with the SHA-256 the receipt seals.',panel.row.src)+(placeboPage?' <a href="/placebo/">Fake my file</a>.':'')+'</figcaption></figure>';
 const results='<h2 id="each-skill">Each skill</h2><p>In the plan\'s order. Each row is one receipt, read by the receipt reader, with the judge\'s limitation beside it. Each opens on its summary line; open a row for its tasks, bands, notes and receipt.</p><div class="placebo-results">'+c.rows.map(rowHTML).join('')+'</div>';
 const method='<h2>Method</h2><p>These sections are the pre-registered note, as the campaign first stored it.</p><h3>What each receipt shows</h3>'+noteSection(c.note,'What each receipt shows')+'<h3>The judge</h3>'+noteSection(c.note,'The judge')+'<h3>Report 018 stands alone</h3>'+noteSection(c.note,'Report 018 stands alone')+'<h3>Which receipt is read</h3>'+noteSection(c.note,'Which receipt is read')+'<h3>Terms</h3>'+noteSection(c.note,'Terms')+'<h3>Who is counted</h3>'+noteSection(c.note,'Who is counted')+'<h3>The hand-off skills</h3>'+noteSection(c.note,'The hand-off skills')+'<h3>The secondary reading</h3>'+noteSection(c.note,'Secondary reading: the placebo against no skill');
 const limits='<h2>Limits</h2><p class="report-scope">'+esc(scopeOf(c)).replace(SNAPSHOT,fig(SNAPSHOT,'specs/408-skill-measurements/popularity.json'))+'</p><p>'+esc(P408.SCOPE)+'</p><p>'+esc(P408.ISOLATION)+'</p><p class="router-subjects">For find-skills, agent-browser, hyperframes and hyperframes-registry: '+esc(P408.ROUTER)+'</p>'+noteSection(c.note,'Limits')+noteSection(c.note,'What the report does not say')+'<p>The placebo corpus was chosen without reference to any task, so a placebo text can still bear on a task by chance.</p><p>Unkeyed seals and retained outputs permit checking internal consistency; they do not authenticate an origin.</p>';
 const surfaces=[...new Set(receipts.map(r=>r.receipt.run.surface))].sort().join(', ');
 const record='<section id="campaign-run-record"><h2>Run record</h2>'+annotateCampaignFigures('<p>One campaign root, <code>'+esc(c.src)+'</code>, read from the latest manifest its log names. '+receipts.length+' of '+c.rows.length+' attempts have a sealed receipt; every other attempt is a recorded failure and reads NOT_MEASURED. The earliest receipt date is '+fig(first.slice(0,10),receipts.find(r=>r.receipt.run.date_utc===first).src)+' and the latest '+fig(lastDate.slice(0,10),receipts.find(r=>r.receipt.run.date_utc===lastDate).src)+'. No finish time is inferred.</p><p>The surface was '+esc(surfaces)+'. Recorded spend across the chain: USD '+c.ledger.spent+'. Recorded costs are API-equivalent estimates, not a subscription invoice.</p>',c.manifests.at(-1).file)+'<ol class="campaign-runs">'+c.manifests.map(m=>'<li><code>'+esc(m.file)+'</code>, SHA-256 <code>'+m.sha256+'</code></li>').join('')+'</ol><p>Plan SHA-256 <code>'+c.ctx.plan_hash+'</code>. Pre-registered note SHA-256 <code>'+c.ctx.plan.outcomes.sha256+'</code>.</p><p>Read and built by:</p><ul class="reader-pins">'+READER.map(f=>'<li><code>'+f+'</code>, SHA-256 <code>'+sha256(fs.readFileSync(path.join(ROOT,f)))+'</code></li>').join('')+'</ul></section>';
 const list='<h2>Receipts</h2><ul>'+receipts.map(r=>'<li><a href="https://github.com/driftproofhq/driftproof/blob/main/'+esc(r.src)+'">'+esc(r.skill)+' on '+esc(humanModelName(r.receipt.run.model_id))+'</a></li>').join('')+'</ul>';
 // The dated records, after the run record and before the receipts so a later entry appends.
 const amendments='<h2 id="amendments">Amendments</h2><section id="amendment-1"><h3>Amendment 1, 3 Nov 2026</h3><p>'+esc(AMENDMENT_1)+'</p></section>'
  +'<section id="amendment-2"><h3>Amendment 2, 4 Nov 2026</h3><p>'+esc(AMENDMENT_2)+'</p></section>'
  +'<section id="amendment-3"><h3>Amendment 3, 4 Nov 2026</h3><p>Added Send this result to each row, with a fixed message that keeps its reading, model, judge, report, caveats and receipt together. A router row also links Report 015 Amendment 1, which says why a router gets no verdict. Counts, readings and receipts are unchanged.</p></section>';
 return head+limitation+headline+panelHTML+results+method+limits+record+amendments+list;
}

function summaryRow(c){return {points:[['What we tested.',TESTED],['What we found.',c.pub.headline[0]],['The judge is the target\'s model.',c.limitation],['Beating the fake is not beating no skill.',CAVEAT],['What it does not show.',scopeOf(c)]].map(([lead,text])=>({lead,text,sources:[{file:'docs/'+REL,quote:text}]}))};}

function buildReport(opts={}){
 const c=readCampaign(opts),placeboPage=opts.placeboPage??fs.existsSync(path.join(ROOT,'docs/placebo/index.html'));
 const raw='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>'+esc(TITLE)+' | Driftproof</title><link rel="stylesheet" href="/style.css"></head><body><main class="report shaped">'+body(c,{panelDir:opts.panelDir||path.join(ROOT,PANEL),placeboPage})+'</main></body></html>\n';
 const row=reportRow('018',{pageRel:'docs/'+REL,html:raw});
 // A second application normalizes the inserted shared chrome's boundary whitespace, as for Report 017.
 return {html:applyHeadTags(applyHeadTags(raw,REL,undefined,undefined,[row]),REL,undefined,undefined,[row]),summary:summaryRow(c),campaign:c};
}

// What a build writes: the page and the 018 row of the summaries, nothing else (AC-18).
function outputs(opts){
 const out=path.resolve(opts.out||path.join(ROOT,'docs'));
 if(opts.stub)need(!(out+path.sep).startsWith(path.join(ROOT,'docs')+path.sep),'OUTPUT_DIRECTORY');
 const built=buildReport(opts),summaryFile=path.join(out,'data/report-summaries.json');
 const summary=JSON.parse(fs.readFileSync(fs.existsSync(summaryFile)?summaryFile:path.join(ROOT,'docs/data/report-summaries.json'),'utf8'));
 summary.reports['018']=built.summary;
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
 const o={campaignRoot:path.join(ROOT,CAMPAIGN)};
 for(let i=0;i<argv.length;i++){const a=argv[i];if(a==='--check')o.check=true;else if(a==='--stub')o.stub=true;else if(['--root','--out','--panel'].includes(a)){const v=argv[++i];need(v&&!v.startsWith('--'),'ARGUMENT');o[{'--root':'campaignRoot','--out':'out','--panel':'panelDir'}[a]]=v;}else C.fail('ARGUMENT');}
 return o;
}
function main(argv=process.argv.slice(2)){
 const o=parse(argv),done=o.check?checkReport(o):writeReport(o),n=done.built.campaign.rows.filter(r=>r.receipt).length;
 console.log('report 018: page and summary '+(o.check?'match':'written from')+' '+n+'/20 sealed '+(o.stub?'stub receipts (test mode, not for publication)':'receipts')+'; headline shape '+done.built.campaign.pub.tally.shape);
}
module.exports={TITLE,REL,CAMPAIGN,PANEL,READER,LIMITATION,CAVEAT,PLAIN,COUNTS,readCampaign,panelOf,tasksOf,rowHTML,chartHTML,plainCountsHTML,buildReport,summaryRow,outputs,writeReport,checkReport,parse,main};
if(require.main===module)try{main();}catch(e){console.error('report 018: refused: '+(e.code||e.message));process.exitCode=1;}
