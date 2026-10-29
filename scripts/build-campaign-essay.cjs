#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';
const fs=require('node:fs'),path=require('node:path'),P=require('../specs/408-skill-measurements/publication.cjs');
const root=path.resolve(__dirname,'..'),pub=P.readPublished(root),esc=require('./site-chrome').esc;
const words=['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen'];
const n=fs.readdirSync(path.join(root,'docs/reports')).filter(x=>/^\d+$/.test(x)&&fs.existsSync(path.join(root,'docs/reports',x,'index.html'))).length;
if(!words[n])throw Error('report count needs an explicit word');
const tally=new Map();for(const item of require('../lib/report-015-publication').eligibleResults(pub.items)){const label=item.verified.reading.label.toLowerCase();tally.set(label,(tally.get(label)||0)+1);}
const paragraph='<p><a href="/reports/015/">Report #015</a> reads the Skills.sh snapshot of 2026-10-17 on text tasks: '+[...tally].map(([label,count])=>count+' '+esc(label)).join(' · ')+'. Each result belongs to one skill and one answering model, on three tasks written by Driftproof. Both model sets use Haiku 5.5 as judge. The report names the driver tasks beside every verdict; overall means do not decide it. The eval account configuration was read and found clean before and after each run, not during it. These written tasks do not establish installation quality or general usefulness.</p>';
const begin='<!--driftproof:campaign-essay-->',end='<!--/driftproof:campaign-essay-->';
const changes=new Map();
const f='docs/writing/three-releases/index.html';let s=fs.readFileSync(path.join(root,f),'utf8');
s=s.replace(/Thirteen reports in/,words[n][0].toUpperCase()+words[n].slice(1)+' reports in').replace(/What I take from (?:thirteen|fourteen|fifteen) reports/,'What I take from '+words[n]+' reports').replace('The newest report is a release too, again run three times.','Report #014 is a release too, again run three times.');
const a016=require('./analyze-report-016').analyzeReport();
const tally016=[['haiku','up','haiku increases'],['haiku','unclear','haiku unclear'],['sonnet','up','sonnet increases'],['sonnet','down','sonnet decreases'],['sonnet','unclear','sonnet unclear']].map(([model,d,label])=>a016.jobs.filter(j=>j.model.includes(model)&&j.metrics.out.file_minus_placebo.direction===d).length+' '+label).join(' · ');
const paragraph016='<p><a href="/reports/016/">Report #016</a> compares popular rules files with no file and a same-length fake on small coding tasks. File-to-fake output comparisons read '+tally016+'. These are behaviour changes, not correctness verdicts. The code was usually already right. The report keeps task-level exceptions, measured-run limits and lost draws beside the results. It tests injected instructions, not native project loading.</p>';
const kinds=new Set(JSON.parse(fs.readFileSync(path.join(root,'docs/data/reports.json'))).reports.map(r=>r.type.value)).size;
s=s.replace(/\b(?:thirteen|fourteen|fifteen) reports in/gi, words[n][0].toUpperCase()+words[n].slice(1)+' reports in').replace(/\b(?:seven|eight) report types\b/g,words[kinds]+' report types');
const block=begin+paragraph+paragraph016+end;
if(s.includes(begin))s=s.replace(new RegExp(begin+'[\\s\\S]*?'+end),block);else s=s.replace('  <p>The part I did not expect',block+'\n\n  <p>The part I did not expect');s=require('./build-head-tags').applyHeadTags(s,f.slice(5));changes.set(f,s);
const readme='README.md',m=fs.readFileSync(path.join(root,readme),'utf8');let updated=m.replace(/\b(thirteen|fourteen|fifteen)( published)? reports/gi,(all,w,qual)=>((w[0]===w[0].toUpperCase())?words[n][0].toUpperCase()+words[n].slice(1):words[n])+(qual||'')+' reports');
updated=updated.replace(/\b(?:seven|eight)( published)? report types\b/g,(_,qual)=>words[kinds]+(qual||'')+' report types');
updated=updated.replace(/the newest being instrument\s+comparison[\s\S]*?which instrument measures:/, 'the newest being rules-file behaviour. Reports that measure with Driftproof retain its correctness reader. The rules-file behaviour report also compares output tokens and code with paired task intervals:\n');
const rb='<!--driftproof:campaign-readme-->',re='<!--/driftproof:campaign-readme-->';
const entry=rb+'\n- **[Report #015: '+P.TITLE+'](https://driftproofhq.com/reports/015/)**: three text tasks per skill, written by Driftproof from the pinned skill descriptions. Both model sets use Haiku 5.5 as judge. Eligible receipts carry their per-task verdicts and the report names the tasks behind them. The four router subjects have no verdict in this revision; the report amendment explains why. The eval account was checked before and after each run, not during it.\n- **[Report #016](https://driftproofhq.com/reports/016/)**: *rules-file behaviour*. '+words[a016.picks.length][0].toUpperCase()+words[a016.picks.length].slice(1)+' popular rules files against no file and same-length fakes. File-to-fake output comparisons: '+tally016+'. These are behaviour changes, not correctness verdicts, on small tasks with injected instructions.\n'+re+'\n\n';
if(updated.includes(rb))updated=updated.replace(new RegExp(rb+'[\\s\\S]*?'+re+'\\n\\n'),entry);else updated=updated.replace('✍️ The launch essay',entry+'✍️ The launch essay');
changes.set(readme,updated);
let stale=0;for(const [rel,bytes]of changes){if(process.argv.includes('--check')){if(fs.readFileSync(path.join(root,rel),'utf8')!==bytes){console.error('stale: '+rel);stale++;}}else fs.writeFileSync(path.join(root,rel),bytes);}
if(stale)process.exitCode=1;else console.log('essay and README pointer: '+n+' reports, campaign tally current');
