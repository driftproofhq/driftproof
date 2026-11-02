#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';
const fs=require('node:fs'),path=require('node:path'),P=require('../specs/408-skill-measurements/publication.cjs');
const root=path.resolve(__dirname,'..'),pub=P.readPublished(root),esc=require('./site-chrome').esc;
const words=['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen'];
const n=fs.readdirSync(path.join(root,'docs/reports')).filter(x=>/^\d+$/.test(x)&&fs.existsSync(path.join(root,'docs/reports',x,'index.html'))).length;
if(!words[n])throw Error('report count needs an explicit word');
const tally=new Map();for(const item of require('../lib/report-015-publication').eligibleResults(pub.items)){const label=item.verified.reading.label.toLowerCase();tally.set(label,(tally.get(label)||0)+1);}
const paragraph='<p><a href="/reports/015/">Report #015</a> reads the Skills.sh snapshot of 2026-10-17 on text tasks: '+[...tally].map(([label,count])=>count+' '+esc(label)).join(' · ')+'. Each result belongs to one skill and one answering model, on three tasks written by Driftproof. Both model sets use Haiku 5.5 as judge. The report names the driver tasks beside every verdict; overall means do not decide it. The eval account configuration was read and found clean before and after each run, not during it. These written tasks do not establish installation quality or general usefulness.</p>';
const begin='<!--driftproof:campaign-essay-->',end='<!--/driftproof:campaign-essay-->';
const changes=new Map();
const f='docs/writing/three-releases/index.html';let s=fs.readFileSync(path.join(root,f),'utf8');
s=s.replace(/Thirteen reports in/,words[n][0].toUpperCase()+words[n].slice(1)+' reports in').replace(/What I take from (?:thirteen|fourteen|fifteen|sixteen) reports/,'What I take from '+words[n]+' reports').replace('The newest report is a release too, again run three times.','Report #014 is a release too, again run three times.');
const a016=require('./analyze-report-016').analyzeReport();
const tally016=[['haiku','up','haiku increases'],['haiku','unclear','haiku unclear'],['sonnet','up','sonnet increases'],['sonnet','down','sonnet decreases'],['sonnet','unclear','sonnet unclear']].map(([model,d,label])=>a016.jobs.filter(j=>j.model.includes(model)&&j.metrics.out.file_minus_placebo.direction===d).length+' '+label).join(' · ');
const paragraph016='<p><a href="/reports/016/">Report #016</a> compares popular rules files with no file and a same-length fake on small coding tasks. File-to-fake output comparisons read '+tally016+'. These are behaviour changes, not correctness verdicts. The code was usually already right. The report keeps task-level exceptions, measured-run limits and lost draws beside the results. It tests injected instructions, not native project loading.</p>';
// Issue 627: Report 017's counts, read by spec 613's publication reader from the campaign root, each
// count before its reading token, out of the 16 the pre-registered headline counts.
const t017=require('../specs/613-placebo-skills-report/publication.cjs').publication({campaignRoot:path.join(root,require('./prepare-report-017').CAMPAIGN),stub:false}).tally;
const tally017=[['A','ABOVE_PLACEBO'],['B','BELOW_PLACEBO'],['D','NO_DIFFERENCE'],['I','INCONCLUSIVE'],['U','UNDERPOWERED'],['M','NOT_MEASURED']].map(([k,token])=>t017[k]+' '+token).join(' · ');
// Issue 652: the README entry is a first-read surface, so each count takes plain words for its
// reading, the counts and their order unchanged; the essay keeps the library's tokens.
// Issue 661: the INCONCLUSIVE, UNDERPOWERED and NOT_MEASURED readings take the verdict library's word
// for the state (lib/verdict.js VERDICTS, the badge's words: "not enough draws" for UNDERPOWERED), not
// spec 128's per-receipt label "too few answers to tell", which spec 435's census read as one of
// Report 015's counts (the 0.26.1 sweep's CONTRADICTORY_COUNT in README.md).
const {VERDICTS}=require('../lib/verdict');
const PLAIN017={ABOVE_PLACEBO:'above the placebo',BELOW_PLACEBO:'below the placebo',NO_DIFFERENCE:'no difference',INCONCLUSIVE:VERDICTS.INCONCLUSIVE.word,UNDERPOWERED:VERDICTS.UNDERPOWERED.word,NOT_MEASURED:VERDICTS.NOT_MEASURED.word};
const plain017=[['A','ABOVE_PLACEBO'],['B','BELOW_PLACEBO'],['D','NO_DIFFERENCE'],['I','INCONCLUSIVE'],['U','UNDERPOWERED'],['M','NOT_MEASURED']].map(([k,token])=>t017[k]+' '+PLAIN017[token]).join(' · ');
const paragraph017='<p><a href="/reports/017/">Report #017</a> reads Report 015&#39;s twenty skills on Sonnet 5.5 against no skill and against a same-length placebo text. Of the '+t017.N+' skills it counts, the placebo readings are '+tally017+'. Only ABOVE_PLACEBO beats the fake, by the case rule. Where the fake scored below no skill, beating it does not mean beating no skill. The four routers are left out of the count. A skill that did not beat the fake is not shown to do no better than it.</p>';
const kinds=new Set(JSON.parse(fs.readFileSync(path.join(root,'docs/data/reports.json'))).reports.map(r=>r.type.value)).size;
s=s.replace(/\b(?:thirteen|fourteen|fifteen|sixteen) reports in/gi, words[n][0].toUpperCase()+words[n].slice(1)+' reports in').replace(/\b(?:seven|eight|nine) report types\b/g,words[kinds]+' report types');
const block=begin+paragraph+paragraph016+paragraph017+end;
if(s.includes(begin))s=s.replace(new RegExp(begin+'[\\s\\S]*?'+end),block);else s=s.replace('  <p>The part I did not expect',block+'\n\n  <p>The part I did not expect');s=require('./build-head-tags').applyHeadTags(s,f.slice(5));changes.set(f,s);
const readme='README.md',m=fs.readFileSync(path.join(root,readme),'utf8');let updated=m.replace(/\b(thirteen|fourteen|fifteen|sixteen)( published)? reports/gi,(all,w,qual)=>((w[0]===w[0].toUpperCase())?words[n][0].toUpperCase()+words[n].slice(1):words[n])+(qual||'')+' reports');
updated=updated.replace(/\b(?:seven|eight|nine)( published)? report types\b/g,(_,qual)=>words[kinds]+(qual||'')+' report types');
updated=updated.replace(/the newest being (?:instrument\s+comparison[\s\S]*?which instrument measures:|rules-file behaviour[\s\S]*?paired task intervals:|placebo comparison[\s\S]*?fixed corpus:)\n/, 'the newest being placebo comparison. Reports that measure with Driftproof retain its correctness reader. The rules-file behaviour report also compares output tokens and code with paired task intervals, and the placebo comparison report reads each skill against a same-length text from a fixed corpus:\n');
const rb='<!--driftproof:campaign-readme-->',re='<!--/driftproof:campaign-readme-->';
const entry=rb+'\n- **[Report #015: '+P.TITLE+'](https://driftproofhq.com/reports/015/)**: three text tasks per skill, written by Driftproof from the pinned skill descriptions. Both model sets use Haiku 5.5 as judge. Eligible receipts carry their per-task verdicts and the report names the tasks behind them. The four router subjects have no verdict in this revision; the report amendment explains why. The eval account was checked before and after each run, not during it.\n- **[Report #016](https://driftproofhq.com/reports/016/)**: *rules-file behaviour*. '+words[a016.picks.length][0].toUpperCase()+words[a016.picks.length].slice(1)+' popular rules files against no file and same-length fakes. File-to-fake output comparisons: '+tally016+'. These are behaviour changes, not correctness verdicts, on small tasks with injected instructions.\n- **[Report #017](https://driftproofhq.com/reports/017/)**: *placebo comparison*. Report 015\'s twenty skills on Sonnet 5.5, each against no skill and against a same-length placebo text, judged by Haiku 5.5. Of the '+t017.N+' skills it counts, the placebo readings are '+plain017+'. A skill is above the placebo when, read one task at a time, it scored above the placebo on at least one task and below it on none; only that beats the fake. Where the fake scored below no skill, beating it does not mean beating no skill. The four routers have no verdict, as in Report 015.\n'+re+'\n\n';
if(updated.includes(rb))updated=updated.replace(new RegExp(rb+'[\\s\\S]*?'+re+'\\n\\n'),entry);else updated=updated.replace('✍️ The launch essay',entry+'✍️ The launch essay');
changes.set(readme,updated);
let stale=0;for(const [rel,bytes]of changes){if(process.argv.includes('--check')){if(fs.readFileSync(path.join(root,rel),'utf8')!==bytes){console.error('stale: '+rel);stale++;}}else fs.writeFileSync(path.join(root,rel),bytes);}
if(stale)process.exitCode=1;else console.log('essay and README pointer: '+n+' reports, campaign tally current');
