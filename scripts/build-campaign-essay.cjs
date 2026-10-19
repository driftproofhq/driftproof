#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';
const fs=require('node:fs'),path=require('node:path'),P=require('../specs/408-skill-measurements/publication.cjs');
const root=path.resolve(__dirname,'..'),pub=P.readPublished(root),esc=require('./site-chrome').esc;
const words=['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen'];
const n=fs.readdirSync(path.join(root,'docs/reports')).filter(x=>/^\d+$/.test(x)&&fs.existsSync(path.join(root,'docs/reports',x,'index.html'))).length;
if(!words[n])throw Error('report count needs an explicit word');
const tally=new Map();for(const item of pub.items){const label=item.verified.reading.label.toLowerCase();tally.set(label,(tally.get(label)||0)+1);}
const paragraph='<p><a href="/reports/015/">Report #015</a> reads the Skills.sh snapshot of 2026-10-17 on text tasks: '+[...tally].map(([label,count])=>count+' '+esc(label)).join(' · ')+'. Each result belongs to one skill and one answering model, on three tasks written by Driftproof. Both model sets use Haiku 5.5 as judge. The report names the driver tasks beside every verdict; overall means do not decide it. The eval account configuration was read and found clean before and after each run, not during it. These written tasks do not establish installation quality or general usefulness.</p>';
const begin='<!--driftproof:campaign-essay-->',end='<!--/driftproof:campaign-essay-->';
const changes=new Map();
const f='docs/writing/three-releases/index.html';let s=fs.readFileSync(path.join(root,f),'utf8');
s=s.replace(/Thirteen reports in/,words[n][0].toUpperCase()+words[n].slice(1)+' reports in').replace(/What I take from (?:thirteen|fourteen) reports/,'What I take from '+words[n]+' reports').replace('The newest report is a release too, again run three times.','Report #014 is a release too, again run three times.');
const block=begin+paragraph+end;
if(s.includes(begin))s=s.replace(new RegExp(begin+'[\\s\\S]*?'+end),block);else s=s.replace('  <p>The part I did not expect',block+'\n\n  <p>The part I did not expect');s=require('./build-head-tags').applyHeadTags(s,f.slice(5));changes.set(f,s);
const readme='README.md',m=fs.readFileSync(path.join(root,readme),'utf8');let updated=m.replace(/\b(thirteen|fourteen)( published)? reports/gi,(all,w,qual)=>((w[0]===w[0].toUpperCase())?words[n][0].toUpperCase()+words[n].slice(1):words[n])+(qual||'')+' reports');
const rb='<!--driftproof:campaign-readme-->',re='<!--/driftproof:campaign-readme-->';
const entry=rb+'\n- **[Report #015: '+P.TITLE+'](https://driftproofhq.com/reports/015/)**: three text tasks per skill, written by Driftproof from the pinned skill descriptions. Both model sets use Haiku 5.5 as judge. Each receipt carries its per-task verdict and the report names the tasks behind it. The eval account was checked before and after each run, not during it.\n'+re+'\n\n';
if(updated.includes(rb))updated=updated.replace(new RegExp(rb+'[\\s\\S]*?'+re+'\\n\\n'),entry);else updated=updated.replace('✍️ The launch essay',entry+'✍️ The launch essay');
changes.set(readme,updated);
let stale=0;for(const [rel,bytes]of changes){if(process.argv.includes('--check')){if(fs.readFileSync(path.join(root,rel),'utf8')!==bytes){console.error('stale: '+rel);stale++;}}else fs.writeFileSync(path.join(root,rel),bytes);}
if(stale)process.exitCode=1;else console.log('essay and README pointer: '+n+' reports, campaign tally current');
