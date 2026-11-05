#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';
// Site builder: {"href":"/can-you-tell/","label":"Can you tell? Every skill"}
// Issue 693. Source selection follows published report links, never campaign logs.
const fs = require('node:fs'), path = require('node:path');
const { sha256 } = require('../lib/canonical');
const { validateReceipt, verifyReceiptHash } = require('../lib/receipt');
const { suiteIdentity } = require('../lib/skill');
const { placeboReading } = require('../lib/verdict');
const { routerLimit, LABEL, REASON } = require('../lib/report-015-publication');
const { HONESTY } = require('../lib/blind');
const { humanModelName } = require('./model-names');
const { applyHeadTags } = require('./build-head-tags');
const ROOT = path.resolve(__dirname, '..'), REL = 'can-you-tell/index.html';
const REPO = 'https://github.com/driftproofhq/driftproof/blob/main/';
const PLAIN = { ABOVE_PLACEBO:'beat the fake', BELOW_PLACEBO:'below the fake', NO_DIFFERENCE:'no difference', INCONCLUSIVE:'inconclusive', UNDERPOWERED:'too few answers to tell', NOT_MEASURED:'not measured' };
const read = p => fs.readFileSync(path.join(ROOT,p),'utf8');
const json = p => JSON.parse(read(p));
const need = (yes, message) => {if (!yes) throw new Error(message);};
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function pairsFor(receipt, archive, rawSuite, mode) {
  need(validateReceipt(receipt).valid && verifyReceiptHash(receipt), 'Receipt does not verify');
  need(archive.receipt_hash === receipt.receipt_hash, 'Answers belong to another receipt');
  const suite = suiteIdentity(rawSuite);
  need(suite.suiteHash === receipt.suite.suite_hash, 'Task suite does not match');
  need(mode === 'skill' || mode === 'twist','Unknown mode');
  const arms = mode === 'skill' ? ['with_skill','placebo'] : ['placebo','baseline'];
  const pairs = []; let dropped = 0;
  for (const row of receipt.results.cases.filter(c => c.mode === arms[0])) {
    const other = receipt.results.cases.find(c => c.id === row.id && c.mode === arms[1]);
    for (const draw of row.generation.draws) {
      if (draw.status !== 'measured') continue;
      const counterpart = other?.generation.draws.find(d => d.draw_index === draw.draw_index);
      if (!counterpart || counterpart.status !== 'measured') {dropped++; continue;}
      const target = archive.answers[draw.generation_hash], answer = archive.answers[counterpart.generation_hash];
      need(typeof target === 'string' && sha256(target) === draw.generation_hash, 'Target answer does not verify');
      need(typeof answer === 'string' && sha256(answer) === counterpart.generation_hash, 'Other answer does not verify');
      const task = suite.cases.find(c => c.id === row.id); need(task, 'Task missing');
      pairs.push({id:row.id, draw:draw.draw_index, prompt:task.prompt, target, other:answer});
    }
  }
  need(pairs.length, 'No verified pairs');
  return {pairs, dropped, count:pairs.length, tasks:new Set(pairs.map(p => p.id)).size, cues:cuesFor(pairs,mode)};
}
function cuesFor(pairs, mode) {
  const labels = mode === 'skill' ? ['skill','fake'] : ['fake','no-skill'];
  const notes = [];
  const section = /suggested skills/i;
  const notSaved = /\b(?:didn['’]t|did not|haven['’]t|have not|can['’]t|cannot|won['’]t|will not)\s+(?:write|written|save|saved)\b/i;
  const opening = text => text.split('\n').find(s => s.trim()) || '';
  for (const [i,key] of ['target','other'].entries()) {
    const opposite = key === 'target' ? 'other' : 'target';
    const n = pairs.filter(p => section.test(p[key])).length;
    if (n > pairs.filter(p => section.test(p[opposite])).length) notes.push('The '+labels[i]+' answers more often mention "Suggested skills".');
    const saved = pairs.filter(p => notSaved.test(opening(p[key]))).length;
    if (saved > pairs.length/2 && saved > pairs.filter(p => notSaved.test(opening(p[opposite]))).length) notes.push('Most '+labels[i]+' answers open by saying they did not save or write a file.');
    if (pairs.filter(p => p[key].length > p[opposite].length).length > pairs.length/2) notes.push('The '+labels[i]+' answer is usually longer.');
  }
  return (notes.length ? notes.join(' ') : 'No consistent difference in length or the checked phrases separates these pairs.')+' These are clues to identity, not proof that an answer is better. Other wording may give it away too.';
}
function dataOf() {
  const suites = fs.readdirSync(path.join(ROOT,'specs/408-skill-measurements/suites')).filter(p => p.endsWith('.json')).map(name => {
    const file='specs/408-skill-measurements/suites/'+name, raw=json(file); return {file,raw,hash:suiteIdentity(raw).suiteHash};
  });
  const entries=[];
  for (const report of ['017','018']) {
    const html=read('docs/reports/'+report+'/index.html');
    const files=[...new Set([...html.matchAll(/href="https:\/\/github\.com\/driftproofhq\/driftproof\/blob\/main\/(receipts\/report-[^" ]+\/[a-f0-9]{64}\.json)"/g)].map(m => m[1]))];
    need(files.length,'Report has no receipts');
    for (const file of files) {
      const r=json(file), answers=file.replace(/\.json$/,'-answers.json'), archive=json(answers);
      const suite=suites.find(s => s.hash === r.suite.suite_hash);need(suite,'Suite missing');
      const games={skill:pairsFor(r,archive,suite.raw,'skill'),twist:pairsFor(r,archive,suite.raw,'twist')};
      const reading=PLAIN[placeboReading(r).reading];need(reading,'Unknown report reading');
      const router=!!routerLimit(r), tasks=new Set(r.results.cases.map(c => c.id)).size;
      const model=humanModelName(r.run.model_id), judge=humanModelName(r.run.judge.model_id);
      const scope=tasks+' text tasks per skill, with tools, network access and file writing forbidden. Answered by '+model+' and judged by '+judge+'. '+(r.run.model_id === r.run.judge.model_id ? "The judge uses the same model as the target. Self-grading may favor its own model's answers. " : '')+'Beating the fake is not beating no skill. These tasks do not show how the skill works elsewhere.';
      entries.push({report,skill:r.skill.name,model,judge,receipt:file,answers,suite:suite.file,hash:r.receipt_hash,router,routerNote:router?LABEL+'. '+REASON+' Left out of the headline count.':'',reading,scope,games});
    }
  }
  entries.sort((a,b) => a.skill.localeCompare(b.skill,'en') || a.report.localeCompare(b.report));
  return {entries,honesty:HONESTY};
}
function pageOf() {
  const data=dataOf(), source=require('node:zlib').gzipSync(Buffer.from(JSON.stringify(data))).toString('base64');
  const skills=[...new Map(data.entries.map(e => [e.skill,e])).values()];
  const options=skills.map(e => '<option value="'+esc(e.skill)+'"'+(e.skill==='handoff'?' selected':'')+'>'+esc(e.skill)+(e.router?' (router)':'')+'</option>').join('');
  const raw='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Can you tell? | Driftproof</title><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/can-you-tell/style.css"></head><body><main class="tell-page story">'
    +'<header class="tell-intro"><p class="tell-eyebrow">A little game of noticing</p><h1>Can you tell?</h1><p class="lede">One task. Two AI answers. One had a skill, the other a same-length fake. Read them, trust your hunch, then reveal.</p><p>This is not a test of you, or a measurement of the skill.</p></header>'
    +'<section class="tell-game" data-island="can-you-tell" data-game-source="'+source+'" aria-label="Can you tell game">'
    +'<div class="tell-setup"><div class="tell-choose"><label for="game-skill">Pick a skill</label><select id="game-skill">'+options+'</select></div><button type="button" data-surprise>Surprise me <span aria-hidden="true">↗</span></button><div class="tell-choose"><label for="game-model">Pick a model</label><select id="game-model"><option value="017">Sonnet 5.5</option><option value="018">Haiku 5.5</option></select></div><div class="tell-choose"><label for="game-mode">Pick your challenge</label><select id="game-mode"><option value="skill">Skill vs fake</option><option value="twist">The twist: fake vs nothing</option></select></div></div>'
    +'<p class="tell-mode" data-mode-note>The fake is unrelated text with the same length as the skill instructions, not the answer.</p>'
    +'<details class="tell-cues"><summary>A clue, if you want one</summary><p data-cues></p></details>'
    +'<div class="tell-play" hidden data-play><div class="tell-progress"><p data-progress aria-live="polite"></p><button type="button" data-again>Shuffle &amp; start over</button></div><h2 data-question>Which answer had the skill?</h2><details class="tell-task" open><summary>The task</summary><section tabindex="0" aria-label="Task prompt" data-prompt></section></details>'
    +'<div class="tell-expand"><p id="preview-note" data-preview-note>Answer previews. Expand both to read every word.</p><button type="button" data-expand aria-expanded="false" aria-controls="answer-A answer-B">Show both answers in full</button></div><div class="tell-answers">'+['A','B'].map(letter => '<section class="tell-card"><h3>Answer '+letter+'</h3><section class="tell-answer" id="answer-'+letter+'" tabindex="0" aria-describedby="preview-note" aria-label="Answer '+letter+'" data-answer="'+letter+'"></section><button type="button" data-pick="'+letter+'" aria-pressed="false">My hunch: '+letter+'</button><p class="tell-identity" data-identity="'+letter+'" hidden></p></section>').join('')+'</div>'
    +'<div class="tell-actions"><button type="button" data-prev>Previous</button><button type="button" data-next>Next pair <span aria-hidden="true">→</span></button><button type="button" class="tell-reveal" data-reveal>Reveal</button></div><p data-status role="status"></p><div class="tell-result" data-result hidden tabindex="-1"></div></div>'
    +'<noscript><p>Turn on JavaScript to play. You can still read <a href="/reports/017/">Report 017</a> and <a href="/reports/018/">Report 018</a> and their kept answers.</p></noscript>'
    +'<aside class="tell-context" aria-label="What this game can tell you"><h2>A hunch stays a hunch</h2><p>'+esc(HONESTY)+'</p><p data-scope>These reports use a small set of text tasks per skill. Beating the fake is not beating no skill. In Report 018 the judge uses the same model as the target. Self-grading may favor its own model\'s answers.</p><p data-router hidden></p><p data-reading></p><p data-counts></p><p data-sources></p></aside></section>'
    +'<details class="tell-about"><summary>About the answers and your privacy</summary><p>These are whole, kept answers from Reports <a href="/reports/017/">017</a> and <a href="/reports/018/">018</a>, matched by task and try. The builder checks the receipt, answer and task hashes. Those checks establish internal consistency, not who made the answers.</p><p>The fake is unrelated text cut to the same length as the skill instructions. Same length does not mean the answers have equal length. The twist uses that fake against no skill at all, from the same run.</p><p>Your picks never leave this page: it sends none of them, stores nothing and calls no model. The site\'s standard visit counter still counts the page view. Changing your selection clears your picks.</p><p>The page source holds which answer is which. Read the pairs before you read the source.</p><p><a href="/reports/017/blind/">The original handoff game</a></p></details></main></body></html>\n';
  return applyHeadTags(applyHeadTags(raw,REL),REL);
}
function check() {need(read('docs/'+REL)===pageOf(),'Can you tell page is stale');}
function write() {fs.mkdirSync(path.join(ROOT,'docs/can-you-tell'),{recursive:true});fs.writeFileSync(path.join(ROOT,'docs',REL),pageOf());}
module.exports={pairsFor,cuesFor,dataOf,pageOf,check,write};
if (require.main===module) {try {need(process.argv.slice(2).every(a => a==='--check'),'Unknown argument');(process.argv.includes('--check')?check:write)();console.log('can you tell: page '+(process.argv.includes('--check')?'matches verified sources':'built from verified sources'));} catch(e) {console.error(e.message);process.exitCode=1;}}
